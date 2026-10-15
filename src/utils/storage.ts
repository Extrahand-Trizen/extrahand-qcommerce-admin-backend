import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import logger from '../config/logger';
import { getPublicApiBase } from './media';
import {
  buildMinioPublicUrl,
  getBucketForSubdir,
  getMinioAccessKey,
  getMinioSecretKey,
  isPrivateBucket,
  isPrivateSubdir,
  parseMinioEndpoint,
} from './minioConfig';

export interface UploadResult {
  url: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), 'uploads');

function ensureLocalDir(subdir: string): string {
  const dir = path.join(LOCAL_UPLOAD_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function getMinioClient() {
  const parsed = parseMinioEndpoint();
  if (!parsed) {
    throw new Error('MinIO endpoint is not configured');
  }

  const { Client } = await import('minio');
  return new Client({
    endPoint: parsed.endPoint,
    port: parsed.port,
    useSSL: parsed.useSSL,
    accessKey: getMinioAccessKey(),
    secretKey: getMinioSecretKey(),
    region: env.MINIO_REGION_NAME || undefined,
  });
}

async function ensureBucket(client: Awaited<ReturnType<typeof getMinioClient>>, bucket: string) {
  const exists = await client.bucketExists(bucket);
  if (!exists) {
    if (env.MINIO_REGION_NAME) {
      await client.makeBucket(bucket, env.MINIO_REGION_NAME);
    } else {
      await client.makeBucket(bucket);
    }
    logger.info(`Created MinIO bucket: ${bucket}`);
  }

  if (isPrivateBucket(bucket)) {
    // SECURITY: Private buckets (seller-doc) must NEVER have anonymous public read access.
    try {
      // Clear wildcard policy if one exists
      await client.setBucketPolicy(bucket, '');
    } catch {
      // Silently continue if empty policy format is rejected
    }
    return;
  }

  try {
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucket}/*`],
        },
      ],
    });
    await client.setBucketPolicy(bucket, policy);
  } catch (err: any) {
    logger.warn(`Could not set bucket policy for ${bucket}: ${err.message}`);
  }
}

async function uploadToMinio(file: Express.Multer.File, subdir: string): Promise<UploadResult> {
  const client = await getMinioClient();
  const bucket = getBucketForSubdir(subdir);
  await ensureBucket(client, bucket);

  const ext = path.extname(file.originalname) || '.bin';
  const storedName = `${uuidv4()}${ext}`;
  const objectName = `${subdir}/${storedName}`;

  await client.putObject(bucket, objectName, file.buffer, file.size, {
    'Content-Type': file.mimetype,
  });

  const url = buildMinioPublicUrl(bucket, objectName);
  logger.info(`Uploaded to MinIO: ${bucket}/${objectName}`);

  return {
    url,
    fileName: file.originalname,
    mimeType: file.mimetype,
    fileSize: file.size,
  };
}

function uploadToLocal(file: Express.Multer.File, subdir: string): UploadResult {
  const ext = path.extname(file.originalname) || '.bin';
  const fileName = `${uuidv4()}${ext}`;
  const dir = ensureLocalDir(subdir);
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, file.buffer);
  const url = `${getPublicApiBase()}/uploads/${subdir}/${fileName}`;
  return { url, fileName: file.originalname, mimeType: file.mimetype, fileSize: file.size };
}

export async function uploadFile(
  file: Express.Multer.File,
  subdir: string,
): Promise<UploadResult> {
  if (env.STORAGE_PROVIDER === 'minio') {
    try {
      return await uploadToMinio(file, subdir);
    } catch (error) {
      logger.error('MinIO upload failed', { subdir, error });
      throw error;
    }
  }

  return uploadToLocal(file, subdir);
}

/**
 * Upload a raw buffer directly to storage (MinIO or local fallback).
 * Used for persisting base64 document images, crops, and system-generated files.
 */
export async function uploadBufferToStorage(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  subdir: string,
): Promise<UploadResult> {
  const ext = path.extname(fileName) || (mimeType.includes('png') ? '.png' : '.jpg');
  const storedName = `${uuidv4()}${ext}`;

  if (env.STORAGE_PROVIDER === 'minio') {
    const client = await getMinioClient();
    const bucket = getBucketForSubdir(subdir);
    await ensureBucket(client, bucket);

    const objectName = `${subdir}/${storedName}`;
    await client.putObject(bucket, objectName, buffer, buffer.length, {
      'Content-Type': mimeType,
    });

    const url = buildMinioPublicUrl(bucket, objectName);
    logger.info(`Uploaded buffer to MinIO: ${bucket}/${objectName}`);

    return {
      url,
      fileName,
      mimeType,
      fileSize: buffer.length,
    };
  }

  // Local disk fallback
  const dir = ensureLocalDir(subdir);
  const filePath = path.join(dir, storedName);
  fs.writeFileSync(filePath, buffer);
  const url = `${getPublicApiBase()}/uploads/${subdir}/${storedName}`;
  return { url, fileName, mimeType, fileSize: buffer.length };
}

/** Generate a short-lived presigned URL for reading private objects from MinIO. Defaults to 24 hours. */
export async function getPresignedReadUrl(
  bucket: string,
  objectName: string,
  expiresInSeconds: number = 86400,
): Promise<string> {
  const client = await getMinioClient();
  return await client.presignedGetObject(bucket, objectName, expiresInSeconds);
}

/**
 * Split a stored asset URL back into `{ bucket, objectName }` for MinIO.
 * SEC-V01:
 * - Uses safe URL parser separating pathname from query parameters.
 * - Rejects already-presigned URLs (does not feed query strings back into object keys).
 * - Validates expected MinIO origin, bucket, and object-key structure.
 * - Rejects malformed, third-party, or path-traversal URLs.
 * - Preserves support for legitimate legacy URL and path formats.
 */
export function parseMinioObjectUrl(url?: string | null): { bucket: string; objectName: string } | null {
  const target = String(url || '').trim();
  if (!target) return null;

  // Local storage paths are never MinIO objects
  if (target.startsWith('/uploads/') || target.startsWith('uploads/')) {
    return null;
  }

  // Reject already-presigned URLs from being re-parsed as raw object keys
  if (target.includes('X-Amz-Signature=') || target.includes('X-Amz-Algorithm=')) {
    return null;
  }

  // Reject proxy file endpoints with signed tokens
  if (target.includes('/documents/') && target.includes('/file') && target.includes('token=')) {
    return null;
  }

  const allowedBuckets = new Set([
    env.MINIO_BUCKET_NAME || 'extrahand-images',
    env.MINIO_SELLER_BUCKET_NAME || 'seller-doc',
    'extrahand-images',
    'seller-doc',
  ]);

  let pathname = '';

  if (/^https?:\/\//i.test(target)) {
    try {
      const parsedUrl = new URL(target);

      // Validate origin/hostname
      const allowedHosts = new Set<string>();
      if (env.MINIO_SERVER_URL) {
        try {
          allowedHosts.add(new URL(env.MINIO_SERVER_URL).host);
        } catch {}
      }
      const parsedEndpoint = parseMinioEndpoint();
      if (parsedEndpoint) {
        allowedHosts.add(parsedEndpoint.endPoint);
        allowedHosts.add(`${parsedEndpoint.endPoint}:${parsedEndpoint.port}`);
      }
      // Allow localhost in non-production
      if (env.NODE_ENV !== 'production') {
        allowedHosts.add(`localhost:${env.MINIO_PORT}`);
        allowedHosts.add('localhost');
        allowedHosts.add(`127.0.0.1:${env.MINIO_PORT}`);
        allowedHosts.add('127.0.0.1');
        allowedHosts.add('minio:9000');
        allowedHosts.add('minio');
      }

      if (allowedHosts.size > 0 && !allowedHosts.has(parsedUrl.host) && !allowedHosts.has(parsedUrl.hostname)) {
        return null; // External/unexpected host
      }

      pathname = parsedUrl.pathname;
    } catch {
      return null;
    }
  } else {
    // Relative or path-only format: strip any query string cleanly
    pathname = target.split('?')[0];
  }

  // Decode and check traversal
  let decodedPath = '';
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decodedPath.includes('..') || decodedPath.includes('\\')) {
    return null;
  }

  const segments = decodedPath.replace(/^\/+/, '').split('/');
  if (segments.length < 2) return null;

  const bucket = segments[0];
  const objectName = segments.slice(1).join('/');

  if (!bucket || !objectName || bucket === 'uploads' || !allowedBuckets.has(bucket)) {
    return null;
  }

  return { bucket, objectName };
}

export interface StoredAssetPath {
  provider: 'minio' | 'local';
  bucket?: string;
  objectName?: string;
  relPath?: string;
  fileName?: string;
}

/**
 * Robustly parses a stored asset URL/path into its provider, bucket/key, or local relative path.
 * Handles full URLs, MinIO paths, and local upload paths.
 */
export function parseStoredAssetPath(targetUrl?: string | null): StoredAssetPath | null {
  const target = String(targetUrl || '').trim();
  if (!target) return null;

  // 1. MinIO check
  const minioParsed = parseMinioObjectUrl(target);
  if (minioParsed) {
    const fileName = path.basename(minioParsed.objectName);
    return {
      provider: 'minio',
      bucket: minioParsed.bucket,
      objectName: minioParsed.objectName,
      relPath: minioParsed.objectName,
      fileName,
    };
  }

  // 2. Local disk check
  const marker = '/uploads/';
  let rel = '';
  const idx = target.indexOf(marker);
  if (idx !== -1) {
    rel = target.slice(idx + marker.length);
  } else if (target.startsWith('uploads/')) {
    rel = target.slice('uploads/'.length);
  } else if (target.startsWith('seller-documents/') || target.startsWith('bank-documents/') || target.startsWith('shop-images/') || target.startsWith('products/')) {
    rel = target;
  }

  if (rel) {
    const cleanRel = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
    const fileName = path.basename(cleanRel);
    return {
      provider: 'local',
      relPath: cleanRel,
      fileName,
    };
  }

  return null;
}

/**
 * Best-effort delete of a previously uploaded asset by its public URL. Never
 * throws — a missing/unreachable object must not fail the caller (e.g. store
 * deletion). Handles both the MinIO and local-disk layouts.
 */
export async function deleteFile(url?: string | null): Promise<void> {
  const target = String(url || '').trim();
  if (!target) return;

  try {
    if (env.STORAGE_PROVIDER === 'minio') {
      const parsed = parseMinioObjectUrl(target);
      if (!parsed) {
        logger.warn('deleteFile: could not parse MinIO url', { url: target });
        return;
      }
      const client = await getMinioClient();
      await client.removeObject(parsed.bucket, parsed.objectName);
      logger.info(`Deleted from MinIO: ${parsed.bucket}/${parsed.objectName}`);
      return;
    }

    // Local disk: URL looks like `<apiBase>/uploads/<subdir>/<file>`.
    const marker = '/uploads/';
    const idx = target.indexOf(marker);
    if (idx === -1) return;
    const rel = target.slice(idx + marker.length);
    const filePath = path.join(LOCAL_UPLOAD_DIR, rel);
    if (filePath.startsWith(LOCAL_UPLOAD_DIR) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Deleted local upload: ${rel}`);
    }
  } catch (err: any) {
    logger.warn('deleteFile failed (non-fatal)', { url: target, error: err?.message });
  }
}

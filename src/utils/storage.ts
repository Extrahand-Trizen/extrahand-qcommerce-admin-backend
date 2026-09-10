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
  parseMinioEndpoint,
} from './minioConfig';

export interface UploadResult {
  url: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

const LOCAL_UPLOAD_DIR = path.join(process.cwd(), 'uploads');

function ensureLocalDir(subdir: string): string {
  const dir = path.join(LOCAL_UPLOAD_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function getMinioClient() {
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

/** Split a stored asset URL back into `{ bucket, objectName }` for MinIO. */
function parseMinioObjectUrl(url: string): { bucket: string; objectName: string } | null {
  let pathPart = url;
  const base = (env.MINIO_SERVER_URL || '').replace(/\/$/, '');
  if (base && url.startsWith(base)) {
    pathPart = url.slice(base.length);
  } else {
    try {
      pathPart = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  const segments = pathPart.replace(/^\/+/, '').split('/');
  if (segments.length < 2) return null;
  const bucket = segments[0];
  const objectName = segments.slice(1).join('/');
  if (!bucket || !objectName) return null;
  return { bucket, objectName };
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

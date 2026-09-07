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

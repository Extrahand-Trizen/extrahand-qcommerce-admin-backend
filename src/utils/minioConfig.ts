import { env } from '../config/env';

export interface ParsedMinioEndpoint {
  endPoint: string;
  port: number;
  useSSL: boolean;
}

export function getMinioAccessKey(): string {
  return env.MINIO_ACCESS_KEY || env.MINIO_ROOT_USER || '';
}

export function getMinioSecretKey(): string {
  return env.MINIO_SECRET_KEY || env.MINIO_ROOT_PASSWORD || '';
}

/** Parse host/port/ssl from MINIO_ENDPOINT or MINIO_SERVER_URL. */
export function parseMinioEndpoint(): ParsedMinioEndpoint | null {
  const raw = env.MINIO_SERVER_URL || env.MINIO_ENDPOINT;
  if (!raw) return null;

  try {
    const withProtocol = raw.includes('://') ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    const useSSL = url.protocol === 'https:';
    const port = url.port ? Number(url.port) : useSSL ? 443 : 80;
    return { endPoint: url.hostname, port, useSSL };
  } catch {
    const host = raw.replace(/^https?:\/\//, '').split('/')[0];
    const [hostname, portPart] = host.split(':');
    return {
      endPoint: hostname,
      port: portPart ? Number(portPart) : env.MINIO_PORT,
      useSSL: env.MINIO_USE_SSL,
    };
  }
}

export function getBucketForSubdir(subdir: string): string {
  if (subdir === 'seller-documents') {
    return env.MINIO_SELLER_BUCKET_NAME;
  }
  return env.MINIO_BUCKET_NAME;
}

export function buildMinioPublicUrl(bucket: string, objectName: string): string {
  const base = (env.MINIO_SERVER_URL || '').replace(/\/$/, '');
  if (base) {
    return `${base}/${bucket}/${objectName}`;
  }

  const parsed = parseMinioEndpoint();
  if (!parsed) return `/${bucket}/${objectName}`;

  const portSuffix =
    (parsed.useSSL && parsed.port === 443) || (!parsed.useSSL && parsed.port === 80)
      ? ''
      : `:${parsed.port}`;
  const protocol = parsed.useSSL ? 'https' : 'http';
  return `${protocol}://${parsed.endPoint}${portSuffix}/${bucket}/${objectName}`;
}

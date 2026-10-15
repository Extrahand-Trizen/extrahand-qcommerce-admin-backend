import { env } from '../config/env';
import { generateDocumentAccessToken, isAlreadyResolvedSecureUrl } from './documentAccess';
import { getPresignedReadUrl, parseMinioObjectUrl } from './storage';

export function getPublicApiBase(): string {
  return (env.PUBLIC_API_URL || `http://localhost:${env.PORT}`).replace(/\/$/, '');
}

/** Turn stored paths into absolute URLs for public clients (local uploads or MinIO). */
export function resolvePublicAssetUrl(url?: string | null): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('file://') || trimmed.startsWith('content://') || trimmed.startsWith('ph://') || trimmed.startsWith('/data/user/')) {
    return '';
  }
  if (/^(https?|data|blob):/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;

  // MinIO object path without protocol, e.g. extrahand-images/shop-images/abc.jpg
  if (!trimmed.startsWith('/') && trimmed.includes('/')) {
    const serverBase = (env.MINIO_SERVER_URL || '').replace(/\/$/, '');
    if (serverBase) return `${serverBase}/${trimmed}`;
  }

  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${getPublicApiBase()}${path}`;
}

/**
 * Build authorized secure access URL for sensitive seller KYC / bank documents.
 * SEC-V01:
 * - Ensures each document reference is resolved exactly once.
 * - If already resolved (presigned MinIO or tokenized proxy), returns it directly.
 * - Does not re-sign or feed signed query params back into object resolution.
 */
export async function resolveSecureDocumentUrl(
  sellerId: string,
  docIdentifier: string,
  url?: string | null,
  expiresInSeconds: number = 86400,
): Promise<string> {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('file://') || trimmed.startsWith('content://') || trimmed.startsWith('ph://') || trimmed.startsWith('/data/user/')) {
    return '';
  }

  // Idempotency guard: If already resolved, never re-resolve or re-sign
  if (isAlreadyResolvedSecureUrl(trimmed)) {
    return trimmed;
  }

  // Authorized backend document endpoint: signs access token and serves file via backend stream (local, MinIO, or base64)
  // This avoids short-lived S3 presigned URLs that expire at the protocol level.
  const { token, expires } = generateDocumentAccessToken(sellerId, docIdentifier, expiresInSeconds);
  const cleanDocId = encodeURIComponent(docIdentifier);
  return `${getPublicApiBase()}/api/v1/sellers/${sellerId}/documents/${cleanDocId}/file?token=${token}&expires=${expires}`;
}

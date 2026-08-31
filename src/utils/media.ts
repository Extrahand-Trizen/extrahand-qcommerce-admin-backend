import { env } from '../config/env';

export function getPublicApiBase(): string {
  return (env.PUBLIC_API_URL || `http://localhost:${env.PORT}`).replace(/\/$/, '');
}

/** Turn stored paths into absolute URLs for clients (local uploads or MinIO). */
export function resolvePublicAssetUrl(url?: string | null): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;

  // MinIO object path without protocol, e.g. seller-doc/seller-documents/abc.jpg
  if (!trimmed.startsWith('/') && trimmed.includes('/')) {
    const serverBase = (env.MINIO_SERVER_URL || '').replace(/\/$/, '');
    if (serverBase) return `${serverBase}/${trimmed}`;
  }

  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${getPublicApiBase()}${path}`;
}

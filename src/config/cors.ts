import { env } from './env';

/** Comma-separated origins from CORS_ORIGIN plus FRONTEND_URL (deduped). */
export function getAllowedCorsOrigins(): string[] {
  const fromList = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
  const extras = [env.FRONTEND_URL.trim()].filter(Boolean);
  return [...new Set([...fromList, ...extras])];
}

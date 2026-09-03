/** Short-lived in-process caches — no Redis required. */

type CacheEntry<T> = { value: T; expiresAt: number };

const caches = new Map<string, CacheEntry<unknown>>();

const DEFAULT_TTL_MS = 60_000;

export function getCached<T>(key: string): T | undefined {
  const entry = caches.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    caches.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  caches.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function getOrLoad<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = getCached<T>(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  setCached(key, value, ttlMs);
  return value;
}

/** Test helper — clears all storefront caches. */
export function clearStorefrontCaches(): void {
  caches.clear();
}

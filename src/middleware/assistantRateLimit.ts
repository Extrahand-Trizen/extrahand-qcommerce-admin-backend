import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { error } from '../utils/response';

type Bucket = { count: number; resetAt: number };

/** Simple in-memory per-user limiter for assistant messages (no Redis). */
const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const MAX_MESSAGES_PER_WINDOW = 30;

export function assistantMessageRateLimit(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const userId = req.user?.sub || req.ip || 'anonymous';
  const now = Date.now();
  let bucket = buckets.get(userId);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(userId, bucket);
  }
  bucket.count += 1;
  if (bucket.count > MAX_MESSAGES_PER_WINDOW) {
    error(res, 'Too many messages. Please wait a moment and try again.', 429);
    return;
  }
  next();
}

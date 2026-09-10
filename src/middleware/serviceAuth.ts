import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

export function serviceAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expected = env.SERVICE_AUTH_TOKEN?.trim();
  const provided = String(req.headers['x-service-auth'] || '').trim();
  if (!expected || !provided || provided !== expected) {
    res.status(provided ? 403 : 401).json({ success: false, error: 'Invalid service authentication' });
    return;
  }
  next();
}
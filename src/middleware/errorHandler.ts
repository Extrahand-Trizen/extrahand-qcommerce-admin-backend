import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';
import { AppError } from '../utils/response';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      details: err.details,
    });
    return;
  }

  if (err.name === 'ValidationError') {
    res.status(400).json({ success: false, error: err.message });
    return;
  }

  if ((err as { code?: number }).code === 11000) {
    const field = Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern || {})[0];
    res.status(409).json({ success: false, error: `${field || 'Field'} already exists` });
    return;
  }

  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ success: false, error: 'Internal server error' });
}

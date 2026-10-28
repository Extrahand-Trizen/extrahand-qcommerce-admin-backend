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
    if (err.statusCode >= 500) {
      logger.error(`AppError (${err.statusCode}): ${err.message}`, { details: err.details, stack: err.stack });
    } else {
      logger.warn(`AppError (${err.statusCode}): ${err.message}`, { details: err.details });
    }
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      details: err.details,
    });
    return;
  }

  if (err.name === 'ValidationError') {
    res.status(400).json({ success: false, error: err.message });
    return;
  }

  if ((err as { code?: number }).code === 11000) {
    const keyPattern = (err as { keyPattern?: Record<string, unknown> }).keyPattern || {};
    if (keyPattern.code || keyPattern.sellerId) {
      res.status(409).json({
        success: false,
        error: keyPattern.code
          ? 'A promotion with this code already exists'
          : 'A promotion with these settings already exists',
      });
      return;
    }
    const field = Object.keys(keyPattern)[0];
    res.status(409).json({ success: false, error: `${field || 'Field'} already exists` });
    return;
  }

  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ success: false, error: 'Internal server error' });
}

import { Response } from 'express';

export function success<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function error(res: Response, message: string, status = 400, details?: unknown) {
  return res.status(status).json({ success: false, error: message, details });
}

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode = 400,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

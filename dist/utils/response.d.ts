import { Response } from 'express';
export declare function success<T>(res: Response, data: T, status?: number): Response<any, Record<string, any>>;
export declare function error(res: Response, message: string, status?: number, details?: unknown): Response<any, Record<string, any>>;
export declare class AppError extends Error {
    message: string;
    statusCode: number;
    details?: unknown | undefined;
    constructor(message: string, statusCode?: number, details?: unknown | undefined);
}

import { Request, Response, NextFunction } from 'express';
import { TokenPayload } from '../utils/jwt';
import { UserRole } from '../types';
export interface AuthRequest extends Request {
    user?: TokenPayload;
}
export declare function authenticate(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireRole(...roles: UserRole[]): (req: AuthRequest, res: Response, next: NextFunction) => void;
/** Attach sellerId for platform-authenticated sellers */
export declare function attachSeller(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
export declare const requireAdmin: ((req: AuthRequest, res: Response, next: NextFunction) => void)[];
export declare const requireSeller: ((req: AuthRequest, res: Response, next: NextFunction) => void)[];
export declare const requireAdminOrSeller: ((req: AuthRequest, res: Response, next: NextFunction) => void)[];

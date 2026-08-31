import { UserRole } from '../types';
export interface TokenPayload {
    sub: string;
    email?: string;
    name?: string;
    role: UserRole;
    sellerId?: string;
    tokenType: 'qc_admin' | 'platform';
    sessionId?: string;
    profileId?: string;
}
export declare function signAccessToken(payload: Omit<TokenPayload, 'tokenType'>): string;
export declare function signRefreshToken(payload: {
    sub: string;
}): string;
/** Try QC admin token first, then platform user-service token */
export declare function verifyToken(token: string): TokenPayload;

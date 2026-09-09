import { Socket } from 'socket.io';
import type { ExtendedError } from 'socket.io/dist/namespace';
import { verifyToken } from '../utils/jwt';
import { fetchVerifiedProfile } from '../utils/userProfile';
import { resolveSellerByUidOrPhone } from '../services/SellerIdentityService';
import logger from '../config/logger';

/**
 * Data we attach to an authenticated seller socket. `sellerId` is resolved
 * server-side from the token — never taken from the client — so a socket can
 * only ever join its own `store:<sellerId>` room (spec §3, §13, §18).
 */
export interface SellerSocketData {
  sellerId: string;
  userId: string;
}

export type SellerSocket = Socket & { data: SellerSocketData };

function readToken(socket: Socket): string | null {
  const fromAuth = socket.handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.trim()) return fromAuth.trim();
  const header = socket.handshake.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Socket.IO handshake middleware. Mirrors REST `attachSeller`: verify the JWT,
 * resolve the seller by Firebase UID, and — if that misses because the UID
 * rotated — recover the existing seller by VERIFIED phone and rebind
 * `Seller.userId`. Rejects only when neither UID nor phone matches a seller.
 */
export async function authenticateSellerSocket(
  socket: Socket,
  next: (err?: ExtendedError) => void,
): Promise<void> {
  try {
    const token = readToken(socket);
    if (!token) {
      logger.warn('socket auth: no token', { id: socket.id });
      return next(new Error('AUTH_REQUIRED'));
    }

    let sub: string;
    try {
      sub = verifyToken(token).sub;
    } catch {
      logger.warn('socket auth: invalid token', { id: socket.id });
      return next(new Error('AUTH_INVALID'));
    }

    // Fast path.
    let resolution = await resolveSellerByUidOrPhone({ userId: sub });

    // Miss → recover by verified phone.
    if (!resolution.ok && resolution.reason === 'NOT_FOUND') {
      const profile = await fetchVerifiedProfile(token);
      if (profile?.phone) {
        resolution = await resolveSellerByUidOrPhone({ userId: sub, verifiedPhone: profile.phone });
      }
    }

    if (!resolution.ok) {
      logger.warn('socket auth: no seller', { id: socket.id, userId: sub, reason: resolution.reason });
      return next(new Error('SELLER_NOT_FOUND'));
    }

    (socket.data as SellerSocketData) = { sellerId: String(resolution.seller._id), userId: sub };
    return next();
  } catch (err) {
    logger.error('socket auth: unexpected error', { error: (err as Error)?.message });
    return next(new Error('AUTH_ERROR'));
  }
}

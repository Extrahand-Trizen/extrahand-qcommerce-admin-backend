import { Socket } from 'socket.io';
import type { ExtendedError } from 'socket.io/dist/namespace';
import { verifyToken } from '../utils/jwt';
import { fetchVerifiedProfile } from '../utils/userProfile';
import { resolveSellerByUidOrPhone } from '../services/SellerIdentityService';
import logger from '../config/logger';

/**
 * Data attached after handshake. `sellerId` / `userId` are resolved server-side
 * from the token — never taken from the client — so sockets only join their own
 * `store:<sellerId>` or `user:<uid>` / owned `order:<id>` rooms.
 */
export type OrderSocketData =
  | { role: 'seller'; sellerId: string; userId: string }
  | { role: 'customer'; userId: string };

/** @deprecated Prefer OrderSocketData; kept for seller-only call sites. */
export type SellerSocketData = Extract<OrderSocketData, { role: 'seller' }>;

export type OrderSocket = Socket & { data: OrderSocketData };
export type SellerSocket = Socket & { data: SellerSocketData };

function readToken(socket: Socket): string | null {
  const fromAuth = socket.handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.trim()) return fromAuth.trim();
  const header = socket.handshake.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Resolve the caller's Firebase/platform UID from a QC JWT or a Firebase token
 * validated via user-service (same path as REST `authenticateCustomer`).
 */
async function resolveUserIdFromToken(token: string): Promise<string | null> {
  try {
    return verifyToken(token).sub;
  } catch {
    // Fall through — mobile clients usually send Firebase ID tokens.
  }

  try {
    const profile = await fetchVerifiedProfile(token);
    if (profile?.uid) return profile.uid;
  } catch {
    // Fall through.
  }
  return null;
}

/**
 * Socket.IO handshake: sellers join store rooms; other authenticated users join
 * as customers. Rejects only when the token is missing/invalid.
 */
export async function authenticateOrderSocket(
  socket: Socket,
  next: (err?: ExtendedError) => void,
): Promise<void> {
  try {
    const token = readToken(socket);
    if (!token) {
      logger.warn('socket auth: no token', { id: socket.id });
      return next(new Error('AUTH_REQUIRED'));
    }

    const userId = await resolveUserIdFromToken(token);
    if (!userId) {
      logger.warn('socket auth: invalid token', { id: socket.id });
      return next(new Error('AUTH_INVALID'));
    }

    // Prefer seller identity when this UID owns a shop (seller app).
    let resolution = await resolveSellerByUidOrPhone({ userId });
    if (!resolution.ok && resolution.reason === 'NOT_FOUND') {
      const profile = await fetchVerifiedProfile(token);
      if (profile?.phone) {
        resolution = await resolveSellerByUidOrPhone({ userId, verifiedPhone: profile.phone });
      }
    }

    if (resolution.ok) {
      (socket.data as OrderSocketData) = {
        role: 'seller',
        sellerId: String(resolution.seller._id),
        userId,
      };
      return next();
    }

    (socket.data as OrderSocketData) = { role: 'customer', userId };
    return next();
  } catch (err) {
    logger.error('socket auth: unexpected error', { error: (err as Error)?.message });
    return next(new Error('AUTH_ERROR'));
  }
}

/** @deprecated Use authenticateOrderSocket — sellers and customers share one namespace. */
export const authenticateSellerSocket = authenticateOrderSocket;

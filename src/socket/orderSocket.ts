import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { Types } from 'mongoose';
import logger from '../config/logger';
import { getAllowedCorsOrigins } from '../config/cors';
import { authenticateOrderSocket, OrderSocket } from './socketAuth';
import type { ICustomerOrder } from '../models/CustomerOrder';
import CustomerOrder from '../models/CustomerOrder';

let io: SocketIOServer | null = null;

const storeRoom = (sellerId: string) => `store:${sellerId}`;
const userRoom = (userId: string) => `user:${userId}`;
const orderRoom = (orderId: string) => `order:${orderId}`;

function emitToCustomerRooms(
  userId: string | undefined | null,
  orderId: string,
  event: string,
  payload: unknown,
): void {
  if (!io || !userId) return;
  io.to(userRoom(userId)).emit(event, payload);
  io.to(orderRoom(orderId)).emit(event, payload);
}

/** Attach the Socket.IO server to the shared HTTP server. Call once at boot. */
export function initOrderSocket(httpServer: HTTPServer): SocketIOServer {
  if (io) return io;

  io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    cors: {
      origin: getAllowedCorsOrigins(),
      credentials: true,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60_000,
    pingInterval: 25_000,
  });

  io.use(authenticateOrderSocket);

  io.on('connection', (socket) => {
    const data = (socket as OrderSocket).data;

    if (data.role === 'seller') {
      void socket.join(storeRoom(data.sellerId));
      // Sellers may also place customer orders; keep their user room for status updates.
      void socket.join(userRoom(data.userId));
      logger.info('socket connected', { id: socket.id, role: 'seller', sellerId: data.sellerId });

      socket.on('sync', (_payload, ack?: (r: unknown) => void) => {
        void socket.join(storeRoom(data.sellerId));
        void socket.join(userRoom(data.userId));
        if (typeof ack === 'function') ack({ ok: true, room: storeRoom(data.sellerId) });
      });

      socket.on('order:join', async (payload: { orderId?: string }, ack?: (r: unknown) => void) => {
        const orderId = typeof payload?.orderId === 'string' ? payload.orderId.trim() : '';
        if (!orderId || !Types.ObjectId.isValid(orderId)) {
          if (typeof ack === 'function') ack({ ok: false, error: 'INVALID_ORDER' });
          return;
        }
        try {
          const owned = await CustomerOrder.exists({ _id: orderId, userId: data.userId });
          if (!owned) {
            if (typeof ack === 'function') ack({ ok: false, error: 'FORBIDDEN' });
            return;
          }
          await socket.join(orderRoom(orderId));
          if (typeof ack === 'function') ack({ ok: true, room: orderRoom(orderId) });
        } catch (err) {
          logger.warn('order:join failed', { orderId, userId: data.userId, error: (err as Error)?.message });
          if (typeof ack === 'function') ack({ ok: false, error: 'JOIN_FAILED' });
        }
      });

      socket.on('order:leave', (payload: { orderId?: string }, ack?: (r: unknown) => void) => {
        const orderId = typeof payload?.orderId === 'string' ? payload.orderId.trim() : '';
        if (orderId) void socket.leave(orderRoom(orderId));
        if (typeof ack === 'function') ack({ ok: true });
      });

      socket.on('disconnect', (reason) => {
        logger.info('socket disconnected', { id: socket.id, role: 'seller', sellerId: data.sellerId, reason });
      });
      return;
    }

    void socket.join(userRoom(data.userId));
    logger.info('socket connected', { id: socket.id, role: 'customer', userId: data.userId });

    socket.on('sync', (_payload, ack?: (r: unknown) => void) => {
      void socket.join(userRoom(data.userId));
      if (typeof ack === 'function') ack({ ok: true, room: userRoom(data.userId) });
    });

    socket.on('order:join', async (payload: { orderId?: string }, ack?: (r: unknown) => void) => {
      const orderId = typeof payload?.orderId === 'string' ? payload.orderId.trim() : '';
      if (!orderId || !Types.ObjectId.isValid(orderId)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'INVALID_ORDER' });
        return;
      }
      try {
        const owned = await CustomerOrder.exists({ _id: orderId, userId: data.userId });
        if (!owned) {
          if (typeof ack === 'function') ack({ ok: false, error: 'FORBIDDEN' });
          return;
        }
        await socket.join(orderRoom(orderId));
        if (typeof ack === 'function') ack({ ok: true, room: orderRoom(orderId) });
      } catch (err) {
        logger.warn('order:join failed', { orderId, userId: data.userId, error: (err as Error)?.message });
        if (typeof ack === 'function') ack({ ok: false, error: 'JOIN_FAILED' });
      }
    });

    socket.on('order:leave', (payload: { orderId?: string }, ack?: (r: unknown) => void) => {
      const orderId = typeof payload?.orderId === 'string' ? payload.orderId.trim() : '';
      if (orderId) void socket.leave(orderRoom(orderId));
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('disconnect', (reason) => {
      logger.info('socket disconnected', { id: socket.id, role: 'customer', userId: data.userId, reason });
    });
  });

  logger.info('Socket.IO order server ready', { path: '/socket.io' });
  return io;
}

export function getOrderSocket(): SocketIOServer | null {
  return io;
}

interface NewOrderEvent {
  event: 'NEW_ORDER';
  orderId: string;
  orderNumber: string;
  storeId: string;
  status: 'NEW';
  createdAt: string;
  totalAmount: number;
  itemCount: number;
}

/**
 * Notify a store's connected seller app(s) that a new order landed. Emitted only
 * AFTER the order is persisted (spec §5). No customer PII in the payload (§4) —
 * the app fetches full detail via the authenticated order API.
 */
export function emitNewOrder(
  order: Pick<ICustomerOrder, '_id' | 'orderNumber' | 'sellerId' | 'items' | 'amountPaise' | 'createdAt' | 'userId'>,
): void {
  if (!io) return;
  if (!order.sellerId) return;

  const sellerId = String(order.sellerId);
  const orderId = String(order._id);
  const payload: NewOrderEvent = {
    event: 'NEW_ORDER',
    orderId,
    orderNumber: order.orderNumber,
    storeId: sellerId,
    status: 'NEW',
    createdAt: (order.createdAt ?? new Date()).toISOString(),
    totalAmount: Math.round((order.amountPaise ?? 0) / 100),
    itemCount: (order.items ?? []).reduce((n, it) => n + (it.quantity ?? 0), 0),
  };

  io.to(storeRoom(sellerId)).emit('NEW_ORDER', payload);
  // Customer status / orders list: same lean payload under ORDER_UPDATED so one listener covers it.
  emitToCustomerRooms(order.userId, orderId, 'ORDER_UPDATED', {
    event: 'ORDER_UPDATED',
    orderId,
    orderNumber: order.orderNumber,
    storeId: sellerId,
    fulfillmentStatus: 'PENDING_ACCEPT',
    status: 'PAID',
    updatedAt: payload.createdAt,
  });
  logger.info('NEW_ORDER emitted', { sellerId, orderNumber: payload.orderNumber });
}

interface OrderUpdatedEvent {
  event: 'ORDER_UPDATED';
  orderId: string;
  orderNumber: string;
  storeId: string;
  /** Seller-driven lifecycle: PENDING_ACCEPT | ACCEPTED | PREPARING | READY | HANDED_OVER | REJECTED | CANCELLED */
  fulfillmentStatus: string;
  /** Parent settlement status. */
  status: string;
  updatedAt: string;
}

/**
 * Any server-side change to one of a store's orders — seller action, customer
 * cancel, or the Track B accept-timeout auto-reject. Also fans out to the
 * customer's `user:` / `order:` rooms so the mobile status screen can refresh
 * without polling. The app fetches the full order via its authenticated API.
 */
export function emitOrderUpdated(
  order: Pick<
    ICustomerOrder,
    '_id' | 'orderNumber' | 'sellerId' | 'fulfillmentStatus' | 'status' | 'updatedAt' | 'userId'
  >,
): void {
  if (!io) return;
  const orderId = String(order._id);
  const sellerId = order.sellerId ? String(order.sellerId) : '';
  const payload: OrderUpdatedEvent = {
    event: 'ORDER_UPDATED',
    orderId,
    orderNumber: order.orderNumber,
    storeId: sellerId,
    fulfillmentStatus: order.fulfillmentStatus ?? 'PENDING_ACCEPT',
    status: order.status,
    updatedAt: (order.updatedAt ?? new Date()).toISOString(),
  };
  if (sellerId) {
    io.to(storeRoom(sellerId)).emit('ORDER_UPDATED', payload);
  }
  emitToCustomerRooms(order.userId, orderId, 'ORDER_UPDATED', payload);
  logger.info('ORDER_UPDATED emitted', {
    sellerId: sellerId || undefined,
    userId: order.userId,
    orderNumber: payload.orderNumber,
    fulfillmentStatus: payload.fulfillmentStatus,
  });
}

interface OrderCompletedEvent {
  event: 'ORDER_COMPLETED';
  orderId: string;
  orderNumber: string;
  storeId: string;
  status: string;
  fulfillmentStatus: 'COMPLETED';
  partnerName: string | null;
  completedAt: string;
}

/**
 * The delivery partner marked the order delivered (HANDED_OVER → COMPLETED via
 * the partner endpoint). The seller app shows a toast and moves the order from
 * the Handover tab to Completed. `ORDER_UPDATED` is emitted alongside this for
 * clients that only listen to the generic channel.
 */
export function emitOrderCompleted(
  order: Pick<
    ICustomerOrder,
    '_id' | 'orderNumber' | 'sellerId' | 'status' | 'partnerName' | 'completedAt' | 'userId'
  >,
): void {
  if (!io) return;
  const orderId = String(order._id);
  const sellerId = order.sellerId ? String(order.sellerId) : '';
  const payload: OrderCompletedEvent = {
    event: 'ORDER_COMPLETED',
    orderId,
    orderNumber: order.orderNumber,
    storeId: sellerId,
    status: order.status,
    fulfillmentStatus: 'COMPLETED',
    partnerName: order.partnerName ?? null,
    completedAt: (order.completedAt ?? new Date()).toISOString(),
  };
  if (sellerId) {
    io.to(storeRoom(sellerId)).emit('ORDER_COMPLETED', payload);
  }
  emitToCustomerRooms(order.userId, orderId, 'ORDER_COMPLETED', payload);
  emitToCustomerRooms(order.userId, orderId, 'ORDER_UPDATED', {
    event: 'ORDER_UPDATED',
    orderId,
    orderNumber: order.orderNumber,
    storeId: sellerId,
    fulfillmentStatus: 'COMPLETED',
    status: order.status,
    updatedAt: payload.completedAt,
  });
  logger.info('ORDER_COMPLETED emitted', { sellerId: sellerId || undefined, orderNumber: payload.orderNumber });
}

interface ShopStatusEvent {
  event: 'SHOP_STATUS';
  storeId: string;
  storeStatus: string;
  autoPaused: boolean;
  pauseUntil: string | null;
  reason?: string;
}

/** Track B — the store was auto-paused (3 rejections/misses) or auto-reopened. */
export function emitShopStatus(
  sellerId: string,
  s: { storeStatus: string; autoPaused: boolean; pauseUntil?: Date | null; reason?: string },
): void {
  if (!io) return;
  const payload: ShopStatusEvent = {
    event: 'SHOP_STATUS',
    storeId: sellerId,
    storeStatus: s.storeStatus,
    autoPaused: s.autoPaused,
    pauseUntil: s.pauseUntil ? s.pauseUntil.toISOString() : null,
    reason: s.reason,
  };
  io.to(storeRoom(sellerId)).emit('SHOP_STATUS', payload);
  logger.info('SHOP_STATUS emitted', { sellerId, storeStatus: s.storeStatus, autoPaused: s.autoPaused });
}

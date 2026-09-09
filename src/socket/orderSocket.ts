import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import logger from '../config/logger';
import { getAllowedCorsOrigins } from '../config/cors';
import { authenticateSellerSocket, SellerSocket } from './socketAuth';
import type { ICustomerOrder } from '../models/CustomerOrder';

let io: SocketIOServer | null = null;

const storeRoom = (sellerId: string) => `store:${sellerId}`;

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

  io.use(authenticateSellerSocket);

  io.on('connection', (socket) => {
    const { sellerId } = (socket as SellerSocket).data;
    void socket.join(storeRoom(sellerId));
    logger.info('socket connected', { id: socket.id, sellerId });

    // Client asks to be sure it's in the right room after a reconnect.
    socket.on('sync', (_payload, ack?: (r: unknown) => void) => {
      void socket.join(storeRoom(sellerId));
      if (typeof ack === 'function') ack({ ok: true, room: storeRoom(sellerId) });
    });

    socket.on('disconnect', (reason) => {
      logger.info('socket disconnected', { id: socket.id, sellerId, reason });
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
export function emitNewOrder(order: Pick<ICustomerOrder, '_id' | 'orderNumber' | 'sellerId' | 'items' | 'amountPaise' | 'createdAt'>): void {
  if (!io) return;
  if (!order.sellerId) return;

  const sellerId = String(order.sellerId);
  const payload: NewOrderEvent = {
    event: 'NEW_ORDER',
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    storeId: sellerId,
    status: 'NEW',
    createdAt: (order.createdAt ?? new Date()).toISOString(),
    totalAmount: Math.round((order.amountPaise ?? 0) / 100),
    itemCount: (order.items ?? []).reduce((n, it) => n + (it.quantity ?? 0), 0),
  };

  io.to(storeRoom(sellerId)).emit('NEW_ORDER', payload);
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
 * cancel, or the Track B accept-timeout auto-reject. The app fetches the full
 * order via its authenticated API and re-buckets it (e.g. into the Rejected tab).
 */
export function emitOrderUpdated(
  order: Pick<ICustomerOrder, '_id' | 'orderNumber' | 'sellerId' | 'fulfillmentStatus' | 'status' | 'updatedAt'>,
): void {
  if (!io || !order.sellerId) return;
  const sellerId = String(order.sellerId);
  const payload: OrderUpdatedEvent = {
    event: 'ORDER_UPDATED',
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    storeId: sellerId,
    fulfillmentStatus: order.fulfillmentStatus ?? 'PENDING_ACCEPT',
    status: order.status,
    updatedAt: (order.updatedAt ?? new Date()).toISOString(),
  };
  io.to(storeRoom(sellerId)).emit('ORDER_UPDATED', payload);
  logger.info('ORDER_UPDATED emitted', { sellerId, orderNumber: payload.orderNumber, fulfillmentStatus: payload.fulfillmentStatus });
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

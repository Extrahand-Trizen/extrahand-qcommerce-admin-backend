/**
 * Order Socket.IO — store isolation, auth, and the NEW_ORDER event.
 *   npx ts-node src/scripts/testOrderSocket.ts
 *
 * Spins up an isolated Socket.IO server (same initOrderSocket used in prod) on a
 * random port, connects two seller clients, and checks that a NEW_ORDER emitted
 * for store A reaches only store A. Uses two real sellers from the DB for the
 * auth lookup; creates no orders. No jest.
 */
import 'dotenv/config';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import { io as ioClient, Socket } from 'socket.io-client';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import { env } from '../config/env';
import { initOrderSocket, emitNewOrder, emitOrderUpdated, emitShopStatus, getOrderSocket } from '../socket/orderSocket';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, extra = '') => {
  ok ? (pass += 1) : (fail += 1);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? `  — ${extra}` : ''}`);
};

function tokenFor(userId: string): string {
  return jwt.sign({ sub: userId, sid: `test-${userId}` }, env.ACCESS_TOKEN_SECRET as string, {
    issuer: env.TOKEN_ISSUER,
    audience: env.TOKEN_AUDIENCE,
    expiresIn: '10m',
  } as jwt.SignOptions);
}

function connect(url: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(url, { path: '/socket.io', auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
}

const waitFor = (s: Socket, event: string, ms: number) =>
  new Promise<unknown>((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    s.once(event, (p) => { clearTimeout(t); resolve(p); });
  });

async function main() {
  if (!env.ACCESS_TOKEN_SECRET) {
    console.error('ACCESS_TOKEN_SECRET not set');
    process.exit(1);
  }
  await connectDatabase();

  const sellers = await Seller.find({ status: { $ne: 'DELETED' } }).select('_id userId').limit(2).lean();
  if (sellers.length < 2) {
    console.error('need at least 2 non-deleted sellers in the DB');
    process.exit(1);
  }
  const [A, B] = sellers;

  const httpServer = createServer();
  initOrderSocket(httpServer);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const port = (httpServer.address() as { port: number }).port;
  const url = `http://localhost:${port}`;
  console.log(`\nisolated socket server on ${url}\nstore A = ${A._id}   store B = ${B._id}\n`);

  // ── AUTH ────────────────────────────────────────────────────────────────
  console.log('AUTH');
  let rejected = false;
  try { await connect(url, 'garbage.token'); } catch { rejected = true; }
  check('bad token rejected', rejected);

  const clientA = await connect(url, tokenFor(A.userId));
  const clientB = await connect(url, tokenFor(B.userId));
  check('valid seller tokens connect', clientA.connected && clientB.connected);

  // ── STORE ISOLATION ─────────────────────────────────────────────────────
  console.log('\nSTORE ISOLATION');
  const gotA = waitFor(clientA, 'NEW_ORDER', 1500);
  const gotB = waitFor(clientB, 'NEW_ORDER', 1500);

  emitNewOrder({
    _id: new Types.ObjectId(),
    orderNumber: 'EH-260909-777001',
    sellerId: A._id as Types.ObjectId,
    items: [{ quantity: 2 } as never, { quantity: 1 } as never],
    amountPaise: 45000,
    createdAt: new Date(),
  } as never);

  const a = (await gotA) as { orderNumber?: string; storeId?: string; itemCount?: number } | undefined;
  const b = await gotB;
  check('store A received NEW_ORDER', a?.orderNumber === 'EH-260909-777001');
  check('payload has storeId + itemCount, no PII', a?.storeId === String(A._id) && a?.itemCount === 3 && !('customer' in (a ?? {})));
  check('store B received nothing', b === undefined);

  // ── ORDER_UPDATED (auto-reject → Rejected tab) ──────────────────────────
  console.log('\nORDER_UPDATED');
  const updA = waitFor(clientA, 'ORDER_UPDATED', 1500);
  const updB = waitFor(clientB, 'ORDER_UPDATED', 1500);
  emitOrderUpdated({
    _id: new Types.ObjectId(),
    orderNumber: 'EH-260909-777002',
    sellerId: A._id as Types.ObjectId,
    fulfillmentStatus: 'REJECTED',
    status: 'CANCELLED',
    updatedAt: new Date(),
  } as never);
  const ua = (await updA) as { fulfillmentStatus?: string; storeId?: string } | undefined;
  check('store A got ORDER_UPDATED (REJECTED)', ua?.fulfillmentStatus === 'REJECTED' && ua?.storeId === String(A._id));
  check('store B got no ORDER_UPDATED', (await updB) === undefined);

  // ── SHOP_STATUS (auto-pause) ───────────────────────────────────────────
  console.log('\nSHOP_STATUS');
  const shopA = waitFor(clientA, 'SHOP_STATUS', 1500);
  const shopB = waitFor(clientB, 'SHOP_STATUS', 1500);
  emitShopStatus(String(A._id), { storeStatus: 'CLOSED', autoPaused: true, pauseUntil: new Date(Date.now() + 180000), reason: 'test' });
  const sa = (await shopA) as { autoPaused?: boolean; storeStatus?: string } | undefined;
  check('store A got SHOP_STATUS (auto-paused)', sa?.autoPaused === true && sa?.storeStatus === 'CLOSED');
  check('store B got no SHOP_STATUS', (await shopB) === undefined);

  // ── RECONNECT SYNC HINT ─────────────────────────────────────────────────
  console.log('\nSYNC');
  const ack = await new Promise<unknown>((resolve) => {
    clientA.emit('sync', {}, (r: unknown) => resolve(r));
    setTimeout(() => resolve(undefined), 1500);
  });
  check('sync ack returns the store room', (ack as { room?: string })?.room === `store:${A._id}`);

  clientA.disconnect();
  clientB.disconnect();
  getOrderSocket()?.close();
  httpServer.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await disconnectDatabase();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

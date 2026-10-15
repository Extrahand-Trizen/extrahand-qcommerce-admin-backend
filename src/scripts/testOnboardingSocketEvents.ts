/**
 * Seller Onboarding Socket.IO Events — Isolation, Auth, and Status Transitions
 *   npx ts-node src/scripts/testOnboardingSocketEvents.ts
 *
 * Verifies real-time seller onboarding status push events:
 * 1. Authentication handshake enforcement
 * 2. Strict seller-to-seller room isolation (store:<sellerId>)
 * 3. Payload security (zero PII, KYC documents, or banking tokens)
 * 4. All onboarding lifecycle events: APPROVE, CHANGES_REQUESTED, REJECT, SUBMITTED
 */
import 'dotenv/config';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import { io as ioClient, Socket } from 'socket.io-client';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import { env } from '../config/env';
import {
  initOrderSocket,
  emitSellerOnboardingUpdated,
  getOrderSocket,
  type SellerOnboardingUpdatedEvent,
} from '../socket/orderSocket';

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
    const s = ioClient(url, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
}

const waitFor = (s: Socket, event: string, ms: number) =>
  new Promise<unknown>((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    s.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

async function main() {
  if (!env.ACCESS_TOKEN_SECRET) {
    console.error('ACCESS_TOKEN_SECRET not set');
    process.exit(1);
  }
  await connectDatabase();

  const sellers = await Seller.find({ status: { $ne: 'DELETED' } }).select('_id userId').limit(2).lean();
  if (sellers.length < 2) {
    console.error('need at least 2 non-deleted sellers in the DB to test room isolation');
    process.exit(1);
  }
  const [A, B] = sellers;

  const httpServer = createServer();
  initOrderSocket(httpServer);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const port = (httpServer.address() as { port: number }).port;
  const url = `http://localhost:${port}`;
  console.log(`\nisolated socket server on ${url}\nSeller A = ${A._id}   Seller B = ${B._id}\n`);

  // ── 1. AUTHENTICATION HANDSHAKE ──────────────────────────────────────────
  console.log('1. AUTHENTICATION HANDSHAKE');
  let rejected = false;
  try {
    await connect(url, 'invalid.tampered.token');
  } catch {
    rejected = true;
  }
  check('unauthenticated / forged token rejected', rejected);

  const clientA = await connect(url, tokenFor(A.userId));
  const clientB = await connect(url, tokenFor(B.userId));
  check('valid seller tokens connect successfully', clientA.connected && clientB.connected);

  // ── 2. SELLER ISOLATION (APPROVAL EVENT) ─────────────────────────────────
  console.log('\n2. SELLER ROOM ISOLATION (APPROVE EVENT)');
  const gotApprovalA = waitFor(clientA, 'SELLER_ONBOARDING_UPDATED', 1500);
  const gotApprovalB = waitFor(clientB, 'SELLER_ONBOARDING_UPDATED', 1500);

  emitSellerOnboardingUpdated(String(A._id), {
    status: 'APPROVED',
    action: 'APPROVED',
    reviewNote: 'Welcome aboard!',
    updatedAt: new Date(),
  });

  const resA = (await gotApprovalA) as SellerOnboardingUpdatedEvent | undefined;
  const resB = await gotApprovalB;

  check('Seller A received SELLER_ONBOARDING_UPDATED event', resA?.status === 'APPROVED');
  check('Seller A event contains matching sellerId', resA?.sellerId === String(A._id));
  check('Seller A action is APPROVED', resA?.action === 'APPROVED');
  check('Seller B received nothing (zero leakage)', resB === undefined);

  // ── 3. PAYLOAD SECURITY & MINIMIZATION ───────────────────────────────────
  console.log('\n3. PAYLOAD SECURITY & SENSITIVE DATA MINIMIZATION');
  const payloadKeys = Object.keys(resA || {});
  const hasNoPan = !('pan' in (resA || {})) && !('panCard' in (resA || {}));
  const hasNoAadhaar = !('aadhaar' in (resA || {})) && !('aadhaarNumber' in (resA || {}));
  const hasNoBank = !('bankAccount' in (resA || {})) && !('accountNumber' in (resA || {}));
  const hasNoDocs = !('documents' in (resA || {})) && !('fileUrl' in (resA || {}));
  check('payload has no PAN or Aadhaar identifiers', hasNoPan && hasNoAadhaar);
  check('payload has no bank details or KYC document URLs', hasNoBank && hasNoDocs);
  check('payload strictly contains only status metadata', payloadKeys.every((k) =>
    ['event', 'sellerId', 'status', 'action', 'reviewNote', 'updatedAt'].includes(k)
  ));

  // ── 4. CHANGES_REQUESTED TRANSITION ──────────────────────────────────────
  console.log('\n4. CHANGES_REQUESTED TRANSITION');
  const gotChangesA = waitFor(clientA, 'SELLER_ONBOARDING_UPDATED', 1500);
  const gotChangesB = waitFor(clientB, 'SELLER_ONBOARDING_UPDATED', 1500);

  emitSellerOnboardingUpdated(String(A._id), {
    status: 'CHANGES_REQUIRED',
    action: 'CHANGES_REQUESTED',
    reviewNote: 'Please re-upload a clearer storefront image.',
    updatedAt: new Date(),
  });

  const changesA = (await gotChangesA) as SellerOnboardingUpdatedEvent | undefined;
  const changesB = await gotChangesB;

  check('Seller A received CHANGES_REQUIRED status', changesA?.status === 'CHANGES_REQUIRED');
  check('Seller A received review note', changesA?.reviewNote === 'Please re-upload a clearer storefront image.');
  check('Seller B received nothing', changesB === undefined);

  // ── 5. REJECTED TRANSITION ───────────────────────────────────────────────
  console.log('\n5. REJECTED TRANSITION');
  const gotRejectionA = waitFor(clientA, 'SELLER_ONBOARDING_UPDATED', 1500);
  const gotRejectionB = waitFor(clientB, 'SELLER_ONBOARDING_UPDATED', 1500);

  emitSellerOnboardingUpdated(String(A._id), {
    status: 'REJECTED',
    action: 'REJECTED',
    reviewNote: 'Shop location outside serviceable operational area.',
    updatedAt: new Date(),
  });

  const rejA = (await gotRejectionA) as SellerOnboardingUpdatedEvent | undefined;
  const rejB = await gotRejectionB;

  check('Seller A received REJECTED status', rejA?.status === 'REJECTED');
  check('Seller A received rejection review note', rejA?.reviewNote === 'Shop location outside serviceable operational area.');
  check('Seller B received nothing', rejB === undefined);

  // ── 6. SUBMISSION / RESUBMISSION TRANSITION ──────────────────────────────
  console.log('\n6. SUBMISSION / RESUBMISSION TRANSITION');
  const gotSubmitA = waitFor(clientA, 'SELLER_ONBOARDING_UPDATED', 1500);

  emitSellerOnboardingUpdated(String(A._id), {
    status: 'PENDING_APPROVAL',
    action: 'RESUBMITTED',
    updatedAt: new Date(),
  });

  const subA = (await gotSubmitA) as SellerOnboardingUpdatedEvent | undefined;
  check('Seller A received PENDING_APPROVAL status on resubmission', subA?.status === 'PENDING_APPROVAL');
  check('Seller A action is RESUBMITTED', subA?.action === 'RESUBMITTED');

  // ── CLEANUP ─────────────────────────────────────────────────────────────
  clientA.disconnect();
  clientB.disconnect();
  getOrderSocket()?.close();
  httpServer.close();

  console.log(`\n========================================`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log(`========================================`);
  await disconnectDatabase();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

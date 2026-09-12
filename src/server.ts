import './models/register';
import { createServer } from 'http';
import app from './app';
import { connectDatabase } from './config/database';
import { env } from './config/env';
import logger from './config/logger';
import { OrderTimeoutService } from './services/OrderTimeoutService';
import { CartReservationService } from './services/CartReservationService';
import { reopenExpiredPauses } from './services/SellerFulfillmentHealthService';
import { ACCEPT_TIMEOUT_SWEEP_MS } from './config/orderFulfillment';
import { initOrderSocket } from './socket/orderSocket';
import { startOrderCompletionWatcher } from './watchers/orderCompletionWatcher';
import { startOrderStatusWatcher } from './watchers/orderStatusWatcher';

async function start() {
  await connectDatabase();

  const httpServer = createServer(app);
  initOrderSocket(httpServer);
  httpServer.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`Quick Commerce API running on port ${env.PORT}`);
    let paymentHost = 'unset';
    try {
      if (env.PAYMENT_SERVICE_URL) paymentHost = new URL(env.PAYMENT_SERVICE_URL).host;
    } catch {
      paymentHost = 'invalid';
    }
    logger.info('qc payment verify target', {
      paymentHost,
      hasServiceAuth: Boolean(
        (env.PAYMENT_SERVICE_AUTH_TOKEN || env.SERVICE_AUTH_TOKEN || '').trim(),
      ),
    });
  });

  // Announce order completion to the seller however the status changed —
  // partner endpoint, direct DB edit, script, ops tool.
  startOrderCompletionWatcher();
  // Fan ORDER_UPDATED to seller + customer rooms for assignment / journey / etc.
  // (including task-service Mongo writes that skip QC service emit helpers).
  startOrderStatusWatcher();

  // Track B — auto-reject + refund orders the shop never accepted before their
  // deadline. A single process runs this; if the backend is scaled out, gate it
  // behind a lock so two instances don't both refund the same order.
  const sweep = setInterval(() => {
    OrderTimeoutService.expireStale()
      .then((n) => {
        if (n) logger.info(`accept-timeout sweep: auto-rejected ${n} order(s)`);
      })
      .catch((err) => logger.error('accept-timeout sweep failed', { err }));
    reopenExpiredPauses()
      .then((n) => {
        if (n) logger.info(`pause sweep: auto-reopened ${n} shop(s)`);
      })
      .catch((err) => logger.error('pause sweep failed', { err }));
    CartReservationService.expireStaleReservations()
      .catch((err) => logger.error('cart reservation expiry sweep failed', { err }));
  }, ACCEPT_TIMEOUT_SWEEP_MS);
  sweep.unref();
}

start().catch((err) => {
  logger.error('Failed to start server', { err });
  process.exit(1);
});

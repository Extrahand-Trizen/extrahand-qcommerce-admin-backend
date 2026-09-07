import './models/register';
import app from './app';
import { connectDatabase } from './config/database';
import { env } from './config/env';
import logger from './config/logger';
import { OrderTimeoutService } from './services/OrderTimeoutService';
import { reopenExpiredPauses } from './services/SellerFulfillmentHealthService';
import { ACCEPT_TIMEOUT_SWEEP_MS } from './config/orderFulfillment';

async function start() {
  await connectDatabase();
  app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`Quick Commerce API running on port ${env.PORT}`);
  });

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
  }, ACCEPT_TIMEOUT_SWEEP_MS);
  sweep.unref();
}

start().catch((err) => {
  logger.error('Failed to start server', { err });
  process.exit(1);
});

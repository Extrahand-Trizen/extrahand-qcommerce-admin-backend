import app from './app';
import { connectDatabase } from './config/database';
import { env } from './config/env';
import logger from './config/logger';

async function start() {
  await connectDatabase();
  app.listen(env.PORT, () => {
    logger.info(`Quick Commerce API running on port ${env.PORT}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start server', { err });
  process.exit(1);
});

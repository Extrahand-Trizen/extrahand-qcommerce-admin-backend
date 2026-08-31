import dns from 'node:dns';
import mongoose from 'mongoose';
import { env } from './env';
import logger from './logger';

// Workaround for local DNS SRV resolution (same as API gateway)
dns.setServers(['8.8.8.8', '8.8.4.4']);

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB,
      serverSelectionTimeoutMS: 5000,
    });
    logger.info('MongoDB connected', { db: mongoose.connection.name });
  } catch (error) {
    logger.error('MongoDB connection failed', { error });
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

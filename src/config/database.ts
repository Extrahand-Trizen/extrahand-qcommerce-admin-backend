import dns from 'node:dns';
import mongoose from 'mongoose';
import { env } from './env';
import logger from './logger';

// Force IPv4 resolution first to prevent secureConnect socket timeouts on Atlas
try {
  dns.setDefaultResultOrder?.('ipv4first');
} catch {
  // Ignore if unsupported
}

try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch {
  // Fallback to system DNS
}

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 2,
      family: 4,
    });
    logger.info('MongoDB connected', { db: mongoose.connection.name });

    // Safeguard: Drop stale sellerId_1_code_1 index without partialFilterExpression
    try {
      const coll = mongoose.connection.collection('promotions');
      const indexes = await coll.indexes();
      const stale = indexes.find(
        (ix: { name?: string; partialFilterExpression?: unknown }) =>
          ix.name === 'sellerId_1_code_1' && !ix.partialFilterExpression
      );
      if (stale) {
        await coll.dropIndex('sellerId_1_code_1');
        logger.info('Dropped stale unique index sellerId_1_code_1 on promotions');
      }
      await coll.createIndex(
        { sellerId: 1, code: 1 },
        { unique: true, partialFilterExpression: { code: { $type: 'string' } } }
      );
    } catch (idxErr) {
      // Ignore if collection not created yet or index is current
    }
  } catch (error) {
    logger.error('MongoDB connection failed', { error });
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4010),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default('extrahand'),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('24h'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  /** Platform user-service JWT — required for seller auth */
  ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
  TOKEN_ISSUER: z.string().default('extrahand-user-service'),
  TOKEN_AUDIENCE: z.string().default('extrahand-clients'),
  SERVICE_AUTH_TOKEN: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),
  FRONTEND_URL: z.string().default('http://localhost:3001'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().default(12),
  STORAGE_PROVIDER: z.enum(['minio', 'local']).default('local'),
  MINIO_ENDPOINT: z.string().optional(),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_USE_SSL: z.coerce.boolean().default(false),
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_ROOT_USER: z.string().optional(),
  MINIO_ROOT_PASSWORD: z.string().optional(),
  MINIO_BUCKET_NAME: z.string().default('extrahand-images'),
  MINIO_SELLER_BUCKET_NAME: z.string().default('seller-doc'),
  MINIO_SERVER_URL: z.string().optional(),
  MINIO_REGION_NAME: z.string().optional(),
  USER_SERVICE_URL: z.string().optional(),
  /** API Gateway — used to validate mobile Firebase tokens on customer routes. */
  API_GATEWAY_URL: z.string().optional(),
  NOTIFICATION_SERVICE_URL: z.string().optional(),
  PAYMENT_SERVICE_URL: z.string().url().optional(),
  /** Firebase service-account creds — enables direct FCM push to sellers
   *  (Track B new-order alert). Provide the three vars below, OR a JSON file
   *  path. All unset = seller push disabled (logs a warning). */
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  /** Public base URL for uploaded assets (mobile app image loading). */
  PUBLIC_API_URL: z.string().optional(),
  /** Default seller for customer storefront when sellerId is not passed. */
  DEFAULT_STOREFRONT_SELLER_ID: z.string().optional(),
});

export const env = envSchema.parse(process.env);

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const zod_1 = require("zod");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    PORT: zod_1.z.coerce.number().default(4010),
    MONGODB_URI: zod_1.z.string().min(1),
    MONGODB_DB: zod_1.z.string().default('extrahand'),
    JWT_SECRET: zod_1.z.string().min(16),
    JWT_EXPIRES_IN: zod_1.z.string().default('24h'),
    REFRESH_TOKEN_EXPIRES_IN: zod_1.z.string().default('7d'),
    /** Platform user-service JWT — required for seller auth */
    ACCESS_TOKEN_SECRET: zod_1.z.string().min(32).optional(),
    TOKEN_ISSUER: zod_1.z.string().default('extrahand-user-service'),
    TOKEN_AUDIENCE: zod_1.z.string().default('extrahand-clients'),
    SERVICE_AUTH_TOKEN: zod_1.z.string().optional(),
    CORS_ORIGIN: zod_1.z.string().default('http://localhost:3001'),
    FRONTEND_URL: zod_1.z.string().default('http://localhost:3001'),
    BCRYPT_SALT_ROUNDS: zod_1.z.coerce.number().default(12),
    STORAGE_PROVIDER: zod_1.z.enum(['minio', 'local']).default('local'),
    MINIO_ENDPOINT: zod_1.z.string().optional(),
    MINIO_PORT: zod_1.z.coerce.number().default(9000),
    MINIO_USE_SSL: zod_1.z.coerce.boolean().default(false),
    MINIO_ACCESS_KEY: zod_1.z.string().optional(),
    MINIO_SECRET_KEY: zod_1.z.string().optional(),
    MINIO_BUCKET_NAME: zod_1.z.string().default('extrahand-qc'),
    USER_SERVICE_URL: zod_1.z.string().optional(),
});
exports.env = envSchema.parse(process.env);

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadFile = uploadFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const env_1 = require("../config/env");
const LOCAL_UPLOAD_DIR = path_1.default.join(process.cwd(), 'uploads');
function ensureLocalDir(subdir) {
    const dir = path_1.default.join(LOCAL_UPLOAD_DIR, subdir);
    fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
async function uploadFile(file, subdir) {
    const ext = path_1.default.extname(file.originalname) || '.bin';
    const fileName = `${(0, uuid_1.v4)()}${ext}`;
    if (env_1.env.STORAGE_PROVIDER === 'minio' && env_1.env.MINIO_ENDPOINT) {
        try {
            const { Client } = await Promise.resolve().then(() => __importStar(require('minio')));
            const client = new Client({
                endPoint: env_1.env.MINIO_ENDPOINT,
                port: env_1.env.MINIO_PORT,
                useSSL: env_1.env.MINIO_USE_SSL,
                accessKey: env_1.env.MINIO_ACCESS_KEY || '',
                secretKey: env_1.env.MINIO_SECRET_KEY || '',
            });
            const bucket = env_1.env.MINIO_BUCKET_NAME;
            const exists = await client.bucketExists(bucket);
            if (!exists)
                await client.makeBucket(bucket);
            const objectName = `${subdir}/${fileName}`;
            await client.putObject(bucket, objectName, file.buffer, file.size, {
                'Content-Type': file.mimetype,
            });
            const protocol = env_1.env.MINIO_USE_SSL ? 'https' : 'http';
            const url = `${protocol}://${env_1.env.MINIO_ENDPOINT}:${env_1.env.MINIO_PORT}/${bucket}/${objectName}`;
            return { url, fileName: file.originalname, mimeType: file.mimetype, fileSize: file.size };
        }
        catch {
            // Fall through to local storage
        }
    }
    const dir = ensureLocalDir(subdir);
    const filePath = path_1.default.join(dir, fileName);
    fs_1.default.writeFileSync(filePath, file.buffer);
    const url = `/uploads/${subdir}/${fileName}`;
    return { url, fileName: file.originalname, mimeType: file.mimetype, fileSize: file.size };
}

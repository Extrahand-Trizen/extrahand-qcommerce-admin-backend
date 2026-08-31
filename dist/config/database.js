"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDatabase = connectDatabase;
exports.disconnectDatabase = disconnectDatabase;
const node_dns_1 = __importDefault(require("node:dns"));
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("./env");
const logger_1 = __importDefault(require("./logger"));
// Workaround for local DNS SRV resolution (same as API gateway)
node_dns_1.default.setServers(['8.8.8.8', '8.8.4.4']);
async function connectDatabase() {
    try {
        await mongoose_1.default.connect(env_1.env.MONGODB_URI, {
            dbName: env_1.env.MONGODB_DB,
            serverSelectionTimeoutMS: 5000,
        });
        logger_1.default.info('MongoDB connected', { db: mongoose_1.default.connection.name });
    }
    catch (error) {
        logger_1.default.error('MongoDB connection failed', { error });
        throw error;
    }
}
async function disconnectDatabase() {
    await mongoose_1.default.disconnect();
}

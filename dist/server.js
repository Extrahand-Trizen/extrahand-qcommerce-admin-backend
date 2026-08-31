"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const database_1 = require("./config/database");
const env_1 = require("./config/env");
const logger_1 = __importDefault(require("./config/logger"));
async function start() {
    await (0, database_1.connectDatabase)();
    app_1.default.listen(env_1.env.PORT, () => {
        logger_1.default.info(`Quick Commerce API running on port ${env_1.env.PORT}`);
    });
}
start().catch((err) => {
    logger_1.default.error('Failed to start server', { err });
    process.exit(1);
});

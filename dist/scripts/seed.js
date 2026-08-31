"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt_1 = __importDefault(require("bcrypt"));
const database_1 = require("../config/database");
const AdminUser_1 = __importDefault(require("../models/AdminUser"));
const env_1 = require("../config/env");
async function seed() {
    await (0, database_1.connectDatabase)();
    const email = 'admin@extrahand.in';
    const passwordHash = await bcrypt_1.default.hash('Admin@123', env_1.env.BCRYPT_SALT_ROUNDS);
    const user = await AdminUser_1.default.findOneAndUpdate({ email }, {
        name: 'QC Admin',
        email,
        passwordHash,
        role: 'ADMIN',
        isActive: true,
    }, { upsert: true, new: true });
    console.log('QC admin ready:', user.email, '/ Admin@123');
    process.exit(0);
}
seed().catch((err) => {
    console.error(err);
    process.exit(1);
});

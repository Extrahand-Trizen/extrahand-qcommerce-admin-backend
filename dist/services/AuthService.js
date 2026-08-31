"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const AdminUser_1 = __importDefault(require("../models/AdminUser"));
const env_1 = require("../config/env");
const jwt_1 = require("../utils/jwt");
const response_1 = require("../utils/response");
class AuthService {
    static async login(email, password) {
        const user = await AdminUser_1.default.findOne({ email: email.toLowerCase() }).select('+passwordHash');
        if (!user || !user.isActive)
            throw new response_1.AppError('Invalid credentials', 401);
        const valid = await user.comparePassword(password);
        if (!valid)
            throw new response_1.AppError('Invalid credentials', 401);
        user.lastLoginAt = new Date();
        await user.save();
        const payload = { sub: user._id.toString(), email: user.email, name: user.name, role: user.role };
        return {
            accessToken: (0, jwt_1.signAccessToken)(payload),
            refreshToken: (0, jwt_1.signRefreshToken)({ sub: user._id.toString() }),
            user: { id: user._id, email: user.email, name: user.name, role: user.role },
        };
    }
    static async register(name, email, password) {
        const existing = await AdminUser_1.default.findOne({ email: email.toLowerCase() });
        if (existing)
            throw new response_1.AppError('Email already registered', 409);
        const passwordHash = await bcrypt_1.default.hash(password, env_1.env.BCRYPT_SALT_ROUNDS);
        const user = await AdminUser_1.default.create({ name, email: email.toLowerCase(), passwordHash, role: 'ADMIN' });
        return { id: user._id, email: user.email, name: user.name, role: user.role };
    }
    static async getMe(userId) {
        const user = await AdminUser_1.default.findById(userId);
        if (!user)
            throw new response_1.AppError('User not found', 404);
        return { id: user._id, email: user.email, name: user.name, role: user.role };
    }
}
exports.AuthService = AuthService;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdminOrSeller = exports.requireSeller = exports.requireAdmin = void 0;
exports.authenticate = authenticate;
exports.requireRole = requireRole;
exports.attachSeller = attachSeller;
const jwt_1 = require("../utils/jwt");
const response_1 = require("../utils/response");
const Seller_1 = __importDefault(require("../models/Seller"));
function authenticate(req, res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        (0, response_1.error)(res, 'Authentication required', 401);
        return;
    }
    try {
        req.user = (0, jwt_1.verifyToken)(token);
        next();
    }
    catch {
        (0, response_1.error)(res, 'Invalid or expired token', 401);
    }
}
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            (0, response_1.error)(res, 'Insufficient permissions', 403);
            return;
        }
        next();
    };
}
/** Attach sellerId for platform-authenticated sellers */
async function attachSeller(req, res, next) {
    if (!req.user) {
        (0, response_1.error)(res, 'Authentication required', 401);
        return;
    }
    const userId = req.user.sub;
    const seller = await Seller_1.default.findOne({ userId });
    if (!seller) {
        (0, response_1.error)(res, 'Seller account not found. Please register first.', 404);
        return;
    }
    req.user.sellerId = seller._id.toString();
    next();
}
exports.requireAdmin = [authenticate, requireRole('ADMIN')];
exports.requireSeller = [
    authenticate,
    requireRole('SELLER'),
    attachSeller,
];
exports.requireAdminOrSeller = [authenticate, requireRole('ADMIN', 'SELLER')];

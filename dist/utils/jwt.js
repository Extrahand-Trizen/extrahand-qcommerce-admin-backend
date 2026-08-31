"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signAccessToken = signAccessToken;
exports.signRefreshToken = signRefreshToken;
exports.verifyToken = verifyToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
function signAccessToken(payload) {
    return jsonwebtoken_1.default.sign({ sub: payload.sub, email: payload.email, name: payload.name, role: payload.role }, env_1.env.JWT_SECRET, { expiresIn: env_1.env.JWT_EXPIRES_IN });
}
function signRefreshToken(payload) {
    return jsonwebtoken_1.default.sign(payload, env_1.env.JWT_SECRET, { expiresIn: env_1.env.REFRESH_TOKEN_EXPIRES_IN });
}
/** Verify QC admin JWT (issued by this service) */
function verifyQcAdminToken(token) {
    const payload = jsonwebtoken_1.default.verify(token, env_1.env.JWT_SECRET);
    return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role || 'ADMIN',
        tokenType: 'qc_admin',
    };
}
/** Verify platform user-service JWT (for sellers) */
function verifyPlatformToken(token) {
    if (!env_1.env.ACCESS_TOKEN_SECRET) {
        throw new Error('Platform token verification not configured');
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, env_1.env.ACCESS_TOKEN_SECRET, {
            issuer: env_1.env.TOKEN_ISSUER,
            audience: env_1.env.TOKEN_AUDIENCE,
        });
        return {
            sub: payload.sub,
            role: 'SELLER',
            tokenType: 'platform',
            sessionId: payload.sid,
            profileId: payload.pid,
        };
    }
    catch (err) {
        if (env_1.env.NODE_ENV !== 'production') {
            const payload = jsonwebtoken_1.default.verify(token, env_1.env.ACCESS_TOKEN_SECRET);
            if (payload?.sub) {
                return {
                    sub: payload.sub,
                    role: 'SELLER',
                    tokenType: 'platform',
                    sessionId: payload.sid,
                    profileId: payload.pid,
                };
            }
        }
        throw err;
    }
}
/** Try QC admin token first, then platform user-service token */
function verifyToken(token) {
    try {
        return verifyQcAdminToken(token);
    }
    catch {
        return verifyPlatformToken(token);
    }
}

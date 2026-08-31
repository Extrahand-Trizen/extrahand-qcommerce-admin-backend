"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const logger_1 = __importDefault(require("../config/logger"));
const response_1 = require("../utils/response");
function errorHandler(err, _req, res, _next) {
    if (err instanceof response_1.AppError) {
        res.status(err.statusCode).json({
            success: false,
            error: err.message,
            details: err.details,
        });
        return;
    }
    if (err.name === 'ValidationError') {
        res.status(400).json({ success: false, error: err.message });
        return;
    }
    if (err.code === 11000) {
        const field = Object.keys(err.keyPattern || {})[0];
        res.status(409).json({ success: false, error: `${field || 'Field'} already exists` });
        return;
    }
    logger_1.default.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ success: false, error: 'Internal server error' });
}

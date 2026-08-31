"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.success = success;
exports.error = error;
function success(res, data, status = 200) {
    return res.status(status).json({ success: true, data });
}
function error(res, message, status = 400, details) {
    return res.status(status).json({ success: false, error: message, details });
}
class AppError extends Error {
    message;
    statusCode;
    details;
    constructor(message, statusCode = 400, details) {
        super(message);
        this.message = message;
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;

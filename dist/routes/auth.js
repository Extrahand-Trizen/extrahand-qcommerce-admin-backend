"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const AuthService_1 = require("../services/AuthService");
const auth_1 = require("../middleware/auth");
const response_1 = require("../utils/response");
const router = (0, express_1.Router)();
router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return (0, response_1.error)(res, 'Email and password required', 400);
        const result = await AuthService_1.AuthService.login(email, password);
        return (0, response_1.success)(res, result);
    }
    catch (e) {
        next(e);
    }
});
router.post('/register', async (req, res, next) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password)
            return (0, response_1.error)(res, 'Name, email and password required', 400);
        const user = await AuthService_1.AuthService.register(name, email, password);
        return (0, response_1.success)(res, user, 201);
    }
    catch (e) {
        next(e);
    }
});
router.get('/me', auth_1.authenticate, async (req, res, next) => {
    try {
        const user = await AuthService_1.AuthService.getMe(req.user.sub);
        return (0, response_1.success)(res, user);
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;

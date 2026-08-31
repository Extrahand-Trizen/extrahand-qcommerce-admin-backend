"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const DashboardService_1 = require("../services/DashboardService");
const auth_1 = require("../middleware/auth");
const response_1 = require("../utils/response");
const router = (0, express_1.Router)();
router.get('/', ...auth_1.requireAdmin, async (_req, res, next) => {
    try {
        const [stats, activity] = await Promise.all([
            DashboardService_1.DashboardService.getStats(),
            DashboardService_1.DashboardService.getRecentActivity(),
        ]);
        return (0, response_1.success)(res, { stats, activity });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ProductSubmissionService_1 = require("../services/ProductSubmissionService");
const auth_1 = require("../middleware/auth");
const response_1 = require("../utils/response");
const router = (0, express_1.Router)();
const admin = auth_1.requireAdmin;
router.get('/', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await ProductSubmissionService_1.ProductSubmissionService.list(req.query));
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await ProductSubmissionService_1.ProductSubmissionService.getById(req.params.id));
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/review', ...admin, async (req, res, next) => {
    try {
        const { action, adminComment, masterProductId } = req.body;
        return (0, response_1.success)(res, await ProductSubmissionService_1.ProductSubmissionService.review(req.params.id, action, adminComment, req.user.sub, masterProductId));
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const SellerService_1 = require("../services/SellerService");
const auth_1 = require("../middleware/auth");
const response_1 = require("../utils/response");
const upload_1 = require("../middleware/upload");
const storage_1 = require("../utils/storage");
const SellerDocument_1 = __importDefault(require("../models/SellerDocument"));
const SellerOnboarding_1 = __importDefault(require("../models/SellerOnboarding"));
const router = (0, express_1.Router)();
const admin = auth_1.requireAdmin;
// Admin: list all sellers
router.get('/', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await SellerService_1.SellerService.listSellers(req.query));
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await SellerService_1.SellerService.getSeller(req.params.id));
    }
    catch (e) {
        next(e);
    }
});
router.patch('/:id/status', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await SellerService_1.SellerService.updateSellerStatus(req.params.id, req.body.status));
    }
    catch (e) {
        next(e);
    }
});
// Admin: approvals
router.get('/approvals/list', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await SellerService_1.SellerService.listApprovals(req.query));
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/approve', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await SellerService_1.SellerService.reviewOnboarding(req.params.id, 'APPROVE', req.body.comment, req.user.sub));
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/reject', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await SellerService_1.SellerService.reviewOnboarding(req.params.id, 'REJECT', req.body.comment, req.user.sub));
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/request-changes', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await SellerService_1.SellerService.reviewOnboarding(req.params.id, 'CHANGES_REQUESTED', req.body.comment, req.user.sub));
    }
    catch (e) {
        next(e);
    }
});
// Seller-facing: platform JWT from user-service
router.post('/register', auth_1.authenticate, async (req, res, next) => {
    try {
        const seller = await SellerService_1.SellerService.registerSeller({
            userId: req.user.sub,
            fullName: req.body.fullName || req.user.name || 'Seller',
            mobileNumber: req.body.mobileNumber,
            email: req.body.email || req.user.email,
        });
        return (0, response_1.success)(res, seller, 201);
    }
    catch (e) {
        next(e);
    }
});
router.get('/onboarding/me', ...auth_1.requireSeller, async (req, res, next) => {
    try {
        const data = await SellerService_1.SellerService.getSeller(req.user.sellerId);
        return (0, response_1.success)(res, data);
    }
    catch (e) {
        next(e);
    }
});
router.put('/onboarding/me', ...auth_1.requireSeller, async (req, res, next) => {
    try {
        const onboarding = await SellerService_1.SellerService.saveOnboarding(req.user.sellerId, req.body, req.body.submit);
        return (0, response_1.success)(res, onboarding);
    }
    catch (e) {
        next(e);
    }
});
router.post('/documents/upload', ...auth_1.requireSeller, upload_1.uploadDocument.single('document'), async (req, res, next) => {
    try {
        if (!req.file)
            return res.status(400).json({ success: false, error: 'No document provided' });
        const result = await (0, storage_1.uploadFile)(req.file, 'seller-documents');
        const onboarding = await SellerOnboarding_1.default.findOne({ sellerId: req.user.sellerId });
        const doc = await SellerDocument_1.default.create({
            sellerId: req.user.sellerId,
            onboardingId: onboarding?._id,
            documentType: req.body.documentType,
            documentNumber: req.body.documentNumber,
            fileUrl: result.url,
            fileName: result.fileName,
            mimeType: result.mimeType,
            fileSize: result.fileSize,
        });
        return (0, response_1.success)(res, doc, 201);
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;

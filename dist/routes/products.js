"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const MasterProductService_1 = require("../services/MasterProductService");
const auth_1 = require("../middleware/auth");
const response_1 = require("../utils/response");
const upload_1 = require("../middleware/upload");
const storage_1 = require("../utils/storage");
const router = (0, express_1.Router)();
const admin = auth_1.requireAdmin;
router.get('/master-products/meta/brands', ...admin, async (_req, res, next) => {
    try {
        return (0, response_1.success)(res, await MasterProductService_1.MasterProductService.listBrands());
    }
    catch (e) {
        next(e);
    }
});
router.get('/master-products', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await MasterProductService_1.MasterProductService.list(req.query));
    }
    catch (e) {
        next(e);
    }
});
router.get('/master-products/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await MasterProductService_1.MasterProductService.getById(req.params.id));
    }
    catch (e) {
        next(e);
    }
});
router.post('/master-products', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await MasterProductService_1.MasterProductService.create(req.body, req.user.sub), 201);
    }
    catch (e) {
        next(e);
    }
});
router.patch('/master-products/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await MasterProductService_1.MasterProductService.update(req.params.id, req.body, req.user.sub));
    }
    catch (e) {
        next(e);
    }
});
router.delete('/master-products/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await MasterProductService_1.MasterProductService.delete(req.params.id));
    }
    catch (e) {
        next(e);
    }
});
router.post('/master-products/upload-image', ...admin, upload_1.uploadImage.single('image'), async (req, res, next) => {
    try {
        if (!req.file)
            return res.status(400).json({ success: false, error: 'No image provided' });
        const result = await (0, storage_1.uploadFile)(req.file, 'products');
        return (0, response_1.success)(res, result, 201);
    }
    catch (e) {
        next(e);
    }
});
// Alias for products list
router.get('/products', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await MasterProductService_1.MasterProductService.list(req.query));
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;

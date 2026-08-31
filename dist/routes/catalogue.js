"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const CatalogueService_1 = require("../services/CatalogueService");
const auth_1 = require("../middleware/auth");
const response_1 = require("../utils/response");
const router = (0, express_1.Router)();
const admin = auth_1.requireAdmin;
// Categories
router.get('/categories', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.listCategories(req.query));
    }
    catch (e) {
        next(e);
    }
});
router.get('/categories/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.getCategory(req.params.id));
    }
    catch (e) {
        next(e);
    }
});
router.post('/categories', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.createCategory(req.body, req.user.sub), 201);
    }
    catch (e) {
        next(e);
    }
});
router.patch('/categories/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.updateCategory(req.params.id, req.body, req.user.sub));
    }
    catch (e) {
        next(e);
    }
});
router.delete('/categories/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.deleteCategory(req.params.id));
    }
    catch (e) {
        next(e);
    }
});
// Subcategories
router.get('/subcategories', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.listSubcategories(req.query));
    }
    catch (e) {
        next(e);
    }
});
router.get('/subcategories/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.getSubcategory(req.params.id));
    }
    catch (e) {
        next(e);
    }
});
router.post('/subcategories', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.createSubcategory(req.body, req.user.sub), 201);
    }
    catch (e) {
        next(e);
    }
});
router.patch('/subcategories/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.updateSubcategory(req.params.id, req.body, req.user.sub));
    }
    catch (e) {
        next(e);
    }
});
router.delete('/subcategories/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.deleteSubcategory(req.params.id));
    }
    catch (e) {
        next(e);
    }
});
// Product Types
router.get('/product-types', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.listProductTypes(req.query));
    }
    catch (e) {
        next(e);
    }
});
router.get('/product-types/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.getProductType(req.params.id));
    }
    catch (e) {
        next(e);
    }
});
router.post('/product-types', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.createProductType(req.body, req.user.sub), 201);
    }
    catch (e) {
        next(e);
    }
});
router.patch('/product-types/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.updateProductType(req.params.id, req.body, req.user.sub));
    }
    catch (e) {
        next(e);
    }
});
router.delete('/product-types/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.deleteProductType(req.params.id));
    }
    catch (e) {
        next(e);
    }
});
// Attributes
router.get('/attributes', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.listAttributes(req.query));
    }
    catch (e) {
        next(e);
    }
});
router.get('/attributes/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.getAttribute(req.params.id));
    }
    catch (e) {
        next(e);
    }
});
router.post('/attributes', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.createAttribute(req.body, req.user.sub), 201);
    }
    catch (e) {
        next(e);
    }
});
router.patch('/attributes/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.updateAttribute(req.params.id, req.body, req.user.sub));
    }
    catch (e) {
        next(e);
    }
});
router.delete('/attributes/:id', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.deleteAttribute(req.params.id));
    }
    catch (e) {
        next(e);
    }
});
// Product Type Attributes
router.get('/product-type-attributes/:productTypeId', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.listProductTypeAttributes(req.params.productTypeId));
    }
    catch (e) {
        next(e);
    }
});
router.put('/product-type-attributes/:productTypeId', ...admin, async (req, res, next) => {
    try {
        return (0, response_1.success)(res, await CatalogueService_1.CatalogueService.setProductTypeAttributes(req.params.productTypeId, req.body.mappings || []));
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;

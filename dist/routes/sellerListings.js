"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const SellerListing_1 = __importDefault(require("../models/SellerListing"));
const auth_1 = require("../middleware/auth");
const response_1 = require("../utils/response");
const pagination_1 = require("../utils/pagination");
const router = (0, express_1.Router)();
router.get('/', ...auth_1.requireAdmin, async (req, res, next) => {
    try {
        const result = await (0, pagination_1.paginate)(SellerListing_1.default, req.query.sellerId ? { sellerId: req.query.sellerId } : {}, req.query, ['sellerId', 'masterProductId']);
        return (0, response_1.success)(res, result);
    }
    catch (e) {
        next(e);
    }
});
router.post('/', ...auth_1.requireSeller, async (req, res, next) => {
    try {
        const listing = await SellerListing_1.default.create({
            sellerId: req.user.sellerId,
            ...req.body,
        });
        return (0, response_1.success)(res, listing, 201);
    }
    catch (e) {
        next(e);
    }
});
router.patch('/:id', ...auth_1.requireAdmin, async (req, res, next) => {
    try {
        const listing = await SellerListing_1.default.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!listing)
            throw new response_1.AppError('Listing not found', 404);
        return (0, response_1.success)(res, listing);
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;

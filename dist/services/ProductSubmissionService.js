"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductSubmissionService = void 0;
const ProductSubmission_1 = __importDefault(require("../models/ProductSubmission"));
const MasterProduct_1 = __importDefault(require("../models/MasterProduct"));
const MasterProductService_1 = require("./MasterProductService");
const pagination_1 = require("../utils/pagination");
const response_1 = require("../utils/response");
class ProductSubmissionService {
    static async list(query) {
        const filter = {};
        if (query.status)
            filter.status = query.status;
        if (query.sellerId)
            filter.sellerId = query.sellerId;
        if (query.search)
            filter.submittedProductName = { $regex: query.search, $options: 'i' };
        return (0, pagination_1.paginate)(ProductSubmission_1.default, filter, query, ['sellerId', 'categoryId', 'subcategoryId', 'productTypeId']);
    }
    static async getById(id) {
        const submission = await ProductSubmission_1.default.findById(id)
            .populate(['sellerId', 'categoryId', 'subcategoryId', 'productTypeId', 'mappedMasterProductId']);
        if (!submission)
            throw new response_1.AppError('Submission not found', 404);
        return submission;
    }
    static async review(id, action, adminComment, adminId, masterProductId) {
        const submission = await ProductSubmission_1.default.findById(id);
        if (!submission)
            throw new response_1.AppError('Submission not found', 404);
        if (submission.status === 'APPROVED')
            throw new response_1.AppError('Submission already approved', 400);
        submission.reviewedBy = adminId;
        submission.reviewedAt = new Date();
        submission.adminComment = adminComment;
        switch (action) {
            case 'APPROVE':
                if (masterProductId) {
                    const existing = await MasterProduct_1.default.findById(masterProductId);
                    if (!existing)
                        throw new response_1.AppError('Master product not found', 404);
                    submission.mappedMasterProductId = existing._id;
                }
                else {
                    const created = await MasterProductService_1.MasterProductService.create({
                        name: submission.submittedProductName,
                        categoryId: submission.categoryId,
                        subcategoryId: submission.subcategoryId,
                        productTypeId: submission.productTypeId,
                        brand: submission.brand,
                        description: submission.description,
                        sku: `SUB-${submission._id.toString().slice(-8).toUpperCase()}`,
                        attributes: submission.requestedAttributes,
                        images: submission.images.map((url, idx) => ({
                            imageUrl: url,
                            displayOrder: idx,
                            isPrimary: idx === 0,
                        })),
                    }, adminId);
                    submission.mappedMasterProductId = created.product._id;
                }
                submission.status = 'APPROVED';
                break;
            case 'REJECT':
                submission.status = 'REJECTED';
                break;
            case 'CHANGES_REQUIRED':
                submission.status = 'CHANGES_REQUIRED';
                break;
            default:
                throw new response_1.AppError('Invalid action', 400);
        }
        await submission.save();
        return submission;
    }
}
exports.ProductSubmissionService = ProductSubmissionService;

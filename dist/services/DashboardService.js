"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardService = void 0;
const Category_1 = __importDefault(require("../models/Category"));
const Subcategory_1 = __importDefault(require("../models/Subcategory"));
const ProductType_1 = __importDefault(require("../models/ProductType"));
const MasterProduct_1 = __importDefault(require("../models/MasterProduct"));
const ProductSubmission_1 = __importDefault(require("../models/ProductSubmission"));
const Seller_1 = __importDefault(require("../models/Seller"));
const SellerOnboarding_1 = __importDefault(require("../models/SellerOnboarding"));
class DashboardService {
    static async getStats() {
        const [totalSellers, activeSellers, pendingSellerApprovals, totalCategories, totalSubcategories, totalProductTypes, totalMasterProducts, activeProducts, pendingProductSubmissions,] = await Promise.all([
            Seller_1.default.countDocuments(),
            Seller_1.default.countDocuments({ status: 'ACTIVE' }),
            SellerOnboarding_1.default.countDocuments({ status: 'PENDING_APPROVAL' }),
            Category_1.default.countDocuments(),
            Subcategory_1.default.countDocuments(),
            ProductType_1.default.countDocuments(),
            MasterProduct_1.default.countDocuments(),
            MasterProduct_1.default.countDocuments({ status: 'ACTIVE' }),
            ProductSubmission_1.default.countDocuments({ status: 'PENDING' }),
        ]);
        return {
            totalSellers,
            activeSellers,
            pendingSellerApprovals,
            totalCategories,
            totalSubcategories,
            totalProductTypes,
            totalMasterProducts,
            activeProducts,
            pendingProductSubmissions,
        };
    }
    static async getRecentActivity() {
        const [recentSellers, recentApprovedSellers, recentProducts, recentSubmissions, pendingApprovals,] = await Promise.all([
            Seller_1.default.find().sort({ createdAt: -1 }).limit(5).lean(),
            Seller_1.default.find({ status: 'ACTIVE' }).sort({ updatedAt: -1 }).limit(5).lean(),
            MasterProduct_1.default.find().sort({ createdAt: -1 }).limit(5)
                .populate(['categoryId', 'productTypeId']).lean(),
            ProductSubmission_1.default.find().sort({ createdAt: -1 }).limit(5)
                .populate('sellerId').lean(),
            SellerOnboarding_1.default.find({ status: 'PENDING_APPROVAL' }).sort({ submittedAt: -1 }).limit(5)
                .populate('sellerId').lean(),
        ]);
        return {
            recentSellers,
            recentApprovedSellers,
            recentProducts,
            recentSubmissions,
            pendingApprovals,
        };
    }
}
exports.DashboardService = DashboardService;

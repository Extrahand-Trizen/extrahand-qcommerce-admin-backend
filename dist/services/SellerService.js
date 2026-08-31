"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SellerService = void 0;
const Seller_1 = __importDefault(require("../models/Seller"));
const SellerOnboarding_1 = __importDefault(require("../models/SellerOnboarding"));
const SellerDocument_1 = __importDefault(require("../models/SellerDocument"));
const SellerApprovalHistory_1 = __importDefault(require("../models/SellerApprovalHistory"));
const pagination_1 = require("../utils/pagination");
const response_1 = require("../utils/response");
class SellerService {
    static async listSellers(query) {
        const filter = {};
        if (query.status)
            filter.status = query.status;
        if (query.onboardingStatus)
            filter.onboardingStatus = query.onboardingStatus;
        if (query.search) {
            filter.$or = [
                { fullName: { $regex: query.search, $options: 'i' } },
                { mobileNumber: { $regex: query.search, $options: 'i' } },
                { email: { $regex: query.search, $options: 'i' } },
            ];
        }
        const result = await (0, pagination_1.paginate)(Seller_1.default, filter, query);
        const sellerIds = result.items.map((s) => s._id);
        const onboardings = await SellerOnboarding_1.default.find({ sellerId: { $in: sellerIds } });
        const onboardingMap = new Map(onboardings.map((o) => [o.sellerId.toString(), o]));
        result.items = result.items.map((s) => ({
            ...s,
            onboarding: onboardingMap.get(s._id.toString()) || null,
        }));
        return result;
    }
    static async getSeller(id) {
        const seller = await Seller_1.default.findById(id);
        if (!seller)
            throw new response_1.AppError('Seller not found', 404);
        const onboarding = await SellerOnboarding_1.default.findOne({ sellerId: id });
        const documents = await SellerDocument_1.default.find({ sellerId: id });
        const history = await SellerApprovalHistory_1.default.find({ sellerId: id }).sort({ performedAt: -1 });
        return { seller, onboarding, documents, history };
    }
    static async listApprovals(query) {
        const filter = {};
        if (query.status)
            filter.status = query.status;
        else
            filter.status = { $in: ['PENDING_APPROVAL', 'CHANGES_REQUIRED'] };
        if (query.shopType)
            filter.shopType = query.shopType;
        if (query.city)
            filter.city = { $regex: query.city, $options: 'i' };
        if (query.search) {
            filter.$or = [
                { shopName: { $regex: query.search, $options: 'i' } },
                { fullName: { $regex: query.search, $options: 'i' } },
            ];
        }
        const result = await (0, pagination_1.paginate)(SellerOnboarding_1.default, filter, query, 'sellerId');
        return result;
    }
    static async reviewOnboarding(sellerId, action, comment, adminId) {
        const seller = await Seller_1.default.findById(sellerId);
        if (!seller)
            throw new response_1.AppError('Seller not found', 404);
        const onboarding = await SellerOnboarding_1.default.findOne({ sellerId });
        if (!onboarding)
            throw new response_1.AppError('Onboarding not found', 404);
        const previousStatus = onboarding.status;
        let newOnboardingStatus;
        let newSellerStatus;
        switch (action) {
            case 'APPROVE':
                newOnboardingStatus = 'APPROVED';
                newSellerStatus = 'ACTIVE';
                break;
            case 'REJECT':
                newOnboardingStatus = 'REJECTED';
                newSellerStatus = 'REJECTED';
                break;
            case 'CHANGES_REQUESTED':
                newOnboardingStatus = 'CHANGES_REQUIRED';
                newSellerStatus = 'PENDING';
                break;
            default:
                throw new response_1.AppError('Invalid action', 400);
        }
        onboarding.status = newOnboardingStatus;
        onboarding.reviewedAt = new Date();
        onboarding.reviewedBy = adminId;
        onboarding.adminComment = comment;
        await onboarding.save();
        seller.status = newSellerStatus;
        seller.onboardingStatus = newOnboardingStatus;
        await seller.save();
        await SellerApprovalHistory_1.default.create({
            sellerId,
            onboardingId: onboarding._id,
            action: action === 'CHANGES_REQUESTED' ? 'CHANGES_REQUESTED' : action,
            previousStatus,
            newStatus: newOnboardingStatus,
            comment,
            performedBy: adminId,
        });
        return { seller, onboarding };
    }
    static async updateSellerStatus(id, status) {
        const seller = await Seller_1.default.findById(id);
        if (!seller)
            throw new response_1.AppError('Seller not found', 404);
        seller.status = status;
        await seller.save();
        return seller;
    }
    // Seller-facing onboarding
    static async registerSeller(data) {
        const existing = await Seller_1.default.findOne({ userId: data.userId });
        if (existing)
            return existing;
        return Seller_1.default.create({ ...data, status: 'PENDING', onboardingStatus: 'DRAFT' });
    }
    static async saveOnboarding(sellerId, data, submit = false) {
        const seller = await Seller_1.default.findById(sellerId);
        if (!seller)
            throw new response_1.AppError('Seller not found', 404);
        let onboarding = await SellerOnboarding_1.default.findOne({ sellerId });
        if (!onboarding) {
            onboarding = await SellerOnboarding_1.default.create({ sellerId, ...data });
        }
        else {
            Object.assign(onboarding, data);
            await onboarding.save();
        }
        if (submit) {
            onboarding.status = 'PENDING_APPROVAL';
            onboarding.submittedAt = new Date();
            seller.onboardingStatus = 'PENDING_APPROVAL';
            await onboarding.save();
            await seller.save();
            await SellerApprovalHistory_1.default.create({
                sellerId,
                onboardingId: onboarding._id,
                action: 'SUBMITTED',
                previousStatus: 'DRAFT',
                newStatus: 'PENDING_APPROVAL',
                performedBy: seller.userId,
            });
        }
        return onboarding;
    }
}
exports.SellerService = SellerService;

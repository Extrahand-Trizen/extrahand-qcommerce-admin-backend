import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerDocument from '../models/SellerDocument';
import SellerApprovalHistory from '../models/SellerApprovalHistory';
import SellerListing from '../models/SellerListing';
import ProductSubmission from '../models/ProductSubmission';
import { paginate } from '../utils/pagination';
import { resolvePublicAssetUrl } from '../utils/media';
import { PaginationQuery, OnboardingStatus, ApprovalAction } from '../types';
import { AppError } from '../utils/response';
import { FilterQuery } from 'mongoose';

export class SellerService {
  static async listSellers(query: PaginationQuery & { status?: string; onboardingStatus?: string }) {
    const filter: FilterQuery<typeof Seller> = {};
    if (query.status) filter.status = query.status;
    if (query.onboardingStatus) filter.onboardingStatus = query.onboardingStatus;
    if (query.search) {
      filter.$or = [
        { fullName: { $regex: query.search, $options: 'i' } },
        { mobileNumber: { $regex: query.search, $options: 'i' } },
        { email: { $regex: query.search, $options: 'i' } },
      ];
    }
    const result = await paginate(Seller, filter, query);
    const sellerIds = result.items.map((s: { _id: unknown }) => s._id);
    const onboardings = await SellerOnboarding.find({ sellerId: { $in: sellerIds } });
    const onboardingMap = new Map(onboardings.map((o) => [o.sellerId.toString(), o]));
    (result as { items: unknown[] }).items = result.items.map((s) => ({
      ...(s as object),
      onboarding: onboardingMap.get((s as { _id: { toString: () => string } })._id.toString()) || null,
    }));
    return result;
  }

  static async getSeller(id: string) {
    const seller = await Seller.findById(id);
    if (!seller) throw new AppError('Seller not found', 404);
    const onboarding = await SellerOnboarding.findOne({ sellerId: id });
    const documents = await SellerDocument.find({ sellerId: id }).lean();
    const history = await SellerApprovalHistory.find({ sellerId: id }).sort({ performedAt: -1 });
    const normalizedDocuments = documents.map((doc) => ({
      ...doc,
      fileUrl: doc.fileUrl ? resolvePublicAssetUrl(doc.fileUrl) : undefined,
    }));
    return { seller, onboarding, documents: normalizedDocuments, history };
  }

  static async listApprovals(query: PaginationQuery & { status?: string; shopType?: string; city?: string }) {
    const filter: FilterQuery<typeof SellerOnboarding> = {};
    if (query.status) filter.status = query.status;
    else filter.status = { $in: ['PENDING_APPROVAL', 'CHANGES_REQUIRED'] };
    if (query.shopType) filter.shopType = query.shopType;
    if (query.city) filter.city = { $regex: query.city, $options: 'i' };
    if (query.search) {
      filter.$or = [
        { shopName: { $regex: query.search, $options: 'i' } },
        { fullName: { $regex: query.search, $options: 'i' } },
      ];
    }
    const result = await paginate(SellerOnboarding, filter, query, 'sellerId');
    return result;
  }

  static async reviewOnboarding(
    sellerId: string,
    action: 'APPROVE' | 'REJECT' | 'CHANGES_REQUESTED',
    comment: string | undefined,
    adminId: string
  ) {
    const seller = await Seller.findById(sellerId);
    if (!seller) throw new AppError('Seller not found', 404);
    const onboarding = await SellerOnboarding.findOne({ sellerId });
    if (!onboarding) throw new AppError('Onboarding not found', 404);

    const previousStatus = onboarding.status;
    let newOnboardingStatus: OnboardingStatus;
    let newSellerStatus: string;

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
        throw new AppError('Invalid action', 400);
    }

    onboarding.status = newOnboardingStatus;
    onboarding.reviewedAt = new Date();
    onboarding.reviewedBy = adminId;
    onboarding.adminComment = comment;
    await onboarding.save();

    seller.status = newSellerStatus as typeof seller.status;
    seller.onboardingStatus = newOnboardingStatus;
    await seller.save();

    const historyAction: ApprovalAction =
      action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED';

    await SellerApprovalHistory.create({
      sellerId,
      onboardingId: onboarding._id,
      action: historyAction,
      previousStatus,
      newStatus: newOnboardingStatus,
      comment,
      performedBy: adminId,
    });

    return { seller, onboarding };
  }

  static async updateSellerStatus(id: string, status: string) {
    const seller = await Seller.findById(id);
    if (!seller) throw new AppError('Seller not found', 404);
    seller.status = status as typeof seller.status;
    await seller.save();
    return seller;
  }

  /** Permanently remove a seller profile and all QC seller-related records. */
  static async deleteSeller(id: string) {
    const seller = await Seller.findById(id);
    if (!seller) throw new AppError('Seller not found', 404);

    await Promise.all([
      SellerOnboarding.deleteMany({ sellerId: id }),
      SellerDocument.deleteMany({ sellerId: id }),
      SellerApprovalHistory.deleteMany({ sellerId: id }),
      SellerListing.deleteMany({ sellerId: id }),
      ProductSubmission.deleteMany({ sellerId: id }),
    ]);

    await Seller.findByIdAndDelete(id);
    return { deleted: true, sellerId: id };
  }

  // Seller-facing onboarding
  static async registerSeller(data: { userId: string; fullName: string; mobileNumber: string; email?: string }) {
    const existing = await Seller.findOne({ userId: data.userId });
    if (existing) return existing;
    return Seller.create({ ...data, status: 'PENDING', onboardingStatus: 'DRAFT' });
  }

  static async saveOnboarding(sellerId: string, data: Record<string, unknown>, submit = false) {
    const seller = await Seller.findById(sellerId);
    if (!seller) throw new AppError('Seller not found', 404);

    const { submit: _submit, ...fields } = data;

    let onboarding = await SellerOnboarding.findOne({ sellerId });
    if (!onboarding) {
      onboarding = await SellerOnboarding.create({ sellerId, ...fields });
    } else {
      Object.assign(onboarding, fields);
      await onboarding.save();
    }

    if (submit) {
      onboarding.status = 'PENDING_APPROVAL';
      onboarding.submittedAt = new Date();
      seller.onboardingStatus = 'PENDING_APPROVAL';
      await onboarding.save();
      await seller.save();
      await SellerApprovalHistory.create({
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

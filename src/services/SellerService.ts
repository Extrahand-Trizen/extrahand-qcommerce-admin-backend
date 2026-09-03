import mongoose from 'mongoose';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerDocument from '../models/SellerDocument';
import SellerApprovalHistory from '../models/SellerApprovalHistory';
import SellerListing from '../models/SellerListing';
import ProductSubmission from '../models/ProductSubmission';
import { SellerCatalogueService } from './SellerCatalogueService';
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

  static async getSeller(id: string): Promise<{
    seller: NonNullable<Awaited<ReturnType<typeof Seller.findById>>>;
    onboarding: Awaited<ReturnType<typeof SellerOnboarding.findOne>>;
    documents: Array<Record<string, unknown>>;
    history: Awaited<ReturnType<typeof SellerApprovalHistory.find>>;
  }> {
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

  /** Admin: paginated list of approved seller stores with inventory counts. */
  static async listStores(query: PaginationQuery & { search?: string; city?: string; status?: string }) {
    const filter: FilterQuery<typeof SellerOnboarding> = { status: 'APPROVED' };
    if (query.city?.trim()) filter.city = { $regex: query.city.trim(), $options: 'i' };
    if (query.status?.trim()) {
      const sellers = await Seller.find({ status: query.status.trim() }).select('_id').lean();
      filter.sellerId = { $in: sellers.map((seller) => seller._id) };
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      filter.$or = [
        { shopName: { $regex: q, $options: 'i' } },
        { fullName: { $regex: q, $options: 'i' } },
        { city: { $regex: q, $options: 'i' } },
        { mobileNumber: { $regex: q, $options: 'i' } },
      ];
    }

    const result = await paginate(SellerOnboarding, filter, query);

    type OnboardingRow = {
      sellerId: mongoose.Types.ObjectId | string;
      shopName?: string;
      shopType?: string;
      city?: string;
      state?: string;
      fullName?: string;
      mobileNumber?: string;
    };

    const sellerIds = [
      ...new Set(
        result.items
          .map((row) => String((row as OnboardingRow).sellerId))
          .filter((id) => mongoose.Types.ObjectId.isValid(id)),
      ),
    ];

    const sellers = sellerIds.length
      ? await Seller.find({ _id: { $in: sellerIds } }).select('_id status').lean()
      : [];
    const sellerMap = new Map(sellers.map((seller) => [String(seller._id), seller]));

    const sellerObjectIds = sellerIds.map((id) => new mongoose.Types.ObjectId(id));
    const counts = sellerObjectIds.length
      ? await SellerListing.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
          { $match: { sellerId: { $in: sellerObjectIds } } },
          { $group: { _id: '$sellerId', count: { $sum: 1 } } },
        ])
      : [];
    const countMap = new Map(counts.map((entry) => [String(entry._id), entry.count]));

    const items = result.items.map((row) => {
      const onboarding = row as OnboardingRow;
      const sellerId = String(onboarding.sellerId);
      const seller = sellerMap.get(sellerId);
      return {
        sellerId,
        shopName: onboarding.shopName ?? '—',
        shopType: onboarding.shopType,
        city: onboarding.city,
        state: onboarding.state,
        ownerName: onboarding.fullName ?? '—',
        mobileNumber: onboarding.mobileNumber ?? '—',
        sellerStatus: seller?.status ?? 'UNKNOWN',
        productCount: countMap.get(sellerId) ?? 0,
      };
    });

    return { ...result, items };
  }

  static async getStoreCategories(sellerId: string) {
    const seller = await Seller.findById(sellerId).select('_id');
    if (!seller) throw new AppError('Seller not found', 404);
    return SellerCatalogueService.listStoreCategories(sellerId);
  }

  static async getStoreProducts(
    sellerId: string,
    query: PaginationQuery & { categoryId?: string; search?: string; availability?: string },
  ) {
    const seller = await Seller.findById(sellerId).select('_id');
    if (!seller) throw new AppError('Seller not found', 404);
    return SellerCatalogueService.listMyListings(sellerId, query);
  }

  // Seller-facing onboarding
  static async registerSeller(data: { userId: string; fullName: string; mobileNumber: string; email?: string }) {
    const existing = await Seller.findOne({ userId: data.userId });
    if (existing) return existing;
    return Seller.create({ ...data, status: 'PENDING', onboardingStatus: 'DRAFT' });
  }

  /**
   * Self-service edit of the non-legal shop profile fields, allowed any time
   * (no re-review). Legal / identity fields (shopName, address, pan, gstin) are
   * NOT editable here — those go through the reviewed onboarding flow.
   */
  static async updateContact(
    sellerId: string,
    data: {
      shopDescription?: string;
      shopMobileNumber?: string;
      shopEmail?: string;
      landmark?: string;
    }
  ) {
    const onboarding = await SellerOnboarding.findOne({ sellerId });
    if (!onboarding) throw new AppError('Complete shop registration first', 404);

    const EDITABLE = ['shopDescription', 'shopMobileNumber', 'shopEmail', 'landmark'] as const;
    for (const key of EDITABLE) {
      if (data[key] !== undefined) {
        const v = String(data[key]).trim();
        (onboarding as unknown as Record<string, unknown>)[key] = v || undefined;
      }
    }
    await onboarding.save();
    return onboarding;
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

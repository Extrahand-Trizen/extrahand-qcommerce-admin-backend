import mongoose, { ClientSession } from 'mongoose';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerDocument from '../models/SellerDocument';
import SellerApprovalHistory from '../models/SellerApprovalHistory';
import SellerListing from '../models/SellerListing';
import SellerStoreSettings from '../models/SellerStoreSettings';
import ShopInventory from '../models/ShopInventory';
import Promotion from '../models/Promotion';
import PromotionRedemption from '../models/PromotionRedemption';
import CustomerOrder from '../models/CustomerOrder';
import CustomerCart from '../models/CustomerCart';
import ProductSubmission from '../models/ProductSubmission';
import { SellerCatalogueService } from './SellerCatalogueService';
import { paginate } from '../utils/pagination';
import { resolvePublicAssetUrl } from '../utils/media';
import { PaginationQuery, OnboardingStatus, ApprovalAction } from '../types';
import { AppError } from '../utils/response';
import { FilterQuery } from 'mongoose';
import { linkSellerToUser, unlinkSeller } from './UserServiceClient';
import { purgeSellerNotifications } from './NotificationServiceClient';
import { deleteFile } from '../utils/storage';
import logger from '../config/logger';

/**
 * Fulfilment states that mean an order is NOT yet cleared — a customer is still
 * waiting, or it's out for delivery. The store cannot be deleted while any of
 * these exist; the seller must hand them over (through to delivery) or reject
 * them first. Terminal states (HANDED_OVER once delivered, REJECTED, CANCELLED)
 * and delivered/cancelled/failed `status` do not block.
 */
const IN_FLIGHT_FULFILLMENT = ['PENDING_ACCEPT', 'ACCEPTED', 'PREPARING', 'READY', 'HANDED_OVER'] as const;
/** Order `status` values that mean the order is fully settled regardless of `fulfillmentStatus`. */
const SETTLED_ORDER_STATUS = ['DELIVERED', 'CANCELLED', 'FAILED', 'completed', 'cancelled'] as const;

/** PAN: 5 letters + 4 digits + 1 letter. */
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** GSTIN: 15 chars. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;
/** FSSAI licence / registration number: 14 digits. */
const FSSAI_RE = /^[0-9]{14}$/;

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
    if (onboarding && onboarding.shopImageUrl) {
      onboarding.shopImageUrl = resolvePublicAssetUrl(onboarding.shopImageUrl);
    }
    return { seller, onboarding, documents: normalizedDocuments, history };
  }

  static async listApprovals(query: PaginationQuery & { status?: string; city?: string }) {
    const filter: FilterQuery<typeof SellerOnboarding> = {};
    if (query.status) filter.status = query.status;
    else filter.status = { $in: ['PENDING_APPROVAL', 'CHANGES_REQUIRED'] };
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
    adminId: string,
    shopType?: string
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

    if (shopType?.trim()) {
      onboarding.shopType = shopType.trim();
    } else if (!onboarding.shopType || !onboarding.shopType.trim()) {
      onboarding.shopType = 'Other';
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

  /**
   * Hard-delete every store-scoped collection for a seller. Shared by the
   * seller-facing `deleteOwnStore` and the admin `deleteSeller`.
   * `SellerApprovalHistory` is intentionally NOT touched — it is detached admin
   * audit (plan decision #16). `MasterProduct` / catalogue is never touched.
   */
  private static async purgeStoreCollections(sellerId: string, session?: ClientSession) {
    const opts = session ? { session } : {};
    await Promise.all([
      SellerOnboarding.deleteMany({ sellerId }, opts),
      SellerDocument.deleteMany({ sellerId }, opts),
      SellerStoreSettings.deleteMany({ sellerId }, opts),
      SellerListing.deleteMany({ sellerId }, opts),
      ShopInventory.deleteMany({ sellerId }, opts),
      Promotion.deleteMany({ sellerId }, opts),
      PromotionRedemption.deleteMany({ sellerId }, opts),
      ProductSubmission.deleteMany({ sellerId }, opts),
      CustomerOrder.deleteMany({ sellerId }, opts),
      CustomerCart.deleteMany({ sellerId }, opts),
    ]);
  }

  /** Collect the public URLs of every uploaded asset owned by this store. */
  private static async collectStoreAssetUrls(sellerId: string): Promise<string[]> {
    const [onboarding, documents] = await Promise.all([
      SellerOnboarding.findOne({ sellerId }).select('shopImageUrl').lean(),
      SellerDocument.find({ sellerId }).select('fileUrl').lean(),
    ]);
    const urls = new Set<string>();
    if (onboarding?.shopImageUrl) urls.add(onboarding.shopImageUrl);
    for (const doc of documents) {
      if (doc.fileUrl) urls.add(doc.fileUrl);
    }
    return [...urls];
  }

  /** Admin: permanently remove a seller profile and all QC seller-related records. */
  static async deleteSeller(id: string) {
    const seller = await Seller.findById(id);
    if (!seller) throw new AppError('Seller not found', 404);

    const assetUrls = await this.collectStoreAssetUrls(id);
    await this.purgeStoreCollections(id);
    await SellerApprovalHistory.deleteMany({ sellerId: id });
    await Seller.findByIdAndDelete(id);

    for (const url of assetUrls) {
      await deleteFile(url).catch(() => undefined);
    }
    try {
      await unlinkSeller(seller.userId, 'Store removed by admin');
    } catch (err: any) {
      logger.error('deleteSeller: user-service unlinkSeller failed', { sellerId: id, error: err?.message });
    }
    try {
      await purgeSellerNotifications(seller.userId);
    } catch (err: any) {
      logger.error('deleteSeller: notification purge failed', { sellerId: id, error: err?.message });
    }

    return { deleted: true, sellerId: id };
  }

  /**
   * Seller-facing: a shopkeeper deletes THEIR OWN store from the seller app.
   *
   * - `Seller` row is soft-deleted (`status='DELETED'`) and its `userId` mangled
   *   to `deleted:<uid>:<ts>` so the real uid is immediately free to re-register.
   * - Every store-scoped collection is hard-deleted (incl. `CustomerOrder` and
   *   `PromotionRedemption` for this store — plan decision #5/#6).
   * - Uploaded assets (FSSAI cert, shop photo) are removed from storage.
   * - The user-service drops the `'seller'` role (or full-deletes the account if
   *   seller was the only role); the notification-service purges seller-role
   *   in-app notifications. Neither can fail the request.
   * - In-flight orders block the delete with a 409.
   */
  static async deleteOwnStore(sellerId: string, opts: { confirm?: boolean; reason?: string }) {
    if (opts?.confirm !== true) {
      throw new AppError('Confirmation required to delete your store', 400);
    }

    const seller = await Seller.findById(sellerId);
    if (!seller || seller.status === 'DELETED') {
      throw new AppError('Seller not found', 404);
    }
    const realUserId = seller.userId;

    // Guard: no deletion at all while any order is still open. The seller must
    // clear (deliver / hand over / reject) every active order first; only then
    // does the delete proceed and wipe the store + all its order history.
    const activeOrders = await CustomerOrder.countDocuments({
      sellerId,
      fulfillmentStatus: { $in: IN_FLIGHT_FULFILLMENT as unknown as string[] },
      status: { $nin: SETTLED_ORDER_STATUS as unknown as string[] },
    });
    if (activeOrders > 0) {
      throw new AppError(
        `You still have ${activeOrders} open order${activeOrders === 1 ? '' : 's'}. ` +
          `Complete, hand over or reject ${activeOrders === 1 ? 'it' : 'them'} first, then delete your store.`,
        409,
      );
    }

    const assetUrls = await this.collectStoreAssetUrls(sellerId);
    const mangledUserId = `deleted:${realUserId}:${Date.now()}`;

    // Prefer a transaction (Atlas replica set); fall back to sequential writes
    // if the deployment doesn't support them.
    let session: ClientSession | null = null;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        await Seller.updateOne(
          { _id: sellerId },
          { $set: { status: 'DELETED', userId: mangledUserId, fcmTokens: [] } },
          { session: session as ClientSession },
        );
        await this.purgeStoreCollections(sellerId, session as ClientSession);
      });
    } catch (err: any) {
      const transactionsUnsupported =
        /Transaction numbers are only allowed|replica set|does not support transactions|IllegalOperation/i.test(
          String(err?.message || ''),
        );
      if (!transactionsUnsupported) throw err;
      logger.warn('deleteOwnStore: transactions unsupported, falling back to sequential writes', { sellerId });
      await Seller.updateOne(
        { _id: sellerId },
        { $set: { status: 'DELETED', userId: mangledUserId, fcmTokens: [] } },
      );
      await this.purgeStoreCollections(sellerId);
    } finally {
      if (session) await session.endSession();
    }

    // Post-commit best-effort cleanup — never fail the request past this point.
    for (const url of assetUrls) {
      await deleteFile(url).catch((e) =>
        logger.warn('deleteOwnStore: asset delete failed', { url, error: e?.message }),
      );
    }
    try {
      await unlinkSeller(realUserId, opts.reason || 'Seller deleted their store');
    } catch (err: any) {
      logger.error('deleteOwnStore: user-service unlinkSeller failed — seller role may be orphaned', {
        sellerId,
        userId: realUserId,
        error: err?.message,
      });
    }
    try {
      await purgeSellerNotifications(realUserId);
    } catch (err: any) {
      logger.error('deleteOwnStore: notification purge failed', { sellerId, error: err?.message });
    }

    logger.info('deleteOwnStore: store deleted', { sellerId, userId: realUserId });
    return { deleted: true };
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
    if (existing) {
      // Backfill the user-service link for sellers created before this wiring.
      void linkSellerToUser(existing.userId, { sellerId: String(existing._id) });
      return existing;
    }
    const seller = await Seller.create({ ...data, status: 'PENDING', onboardingStatus: 'DRAFT' });
    // Link the new Seller record to the user Profile (best-effort).
    void linkSellerToUser(seller.userId, { sellerId: String(seller._id) });
    return seller;
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
      shopImageUrl?: string;
      shopImage?: string;
    }
  ) {
    const onboarding = await SellerOnboarding.findOne({ sellerId });
    if (!onboarding) throw new AppError('Complete shop registration first', 404);

    const EDITABLE = ['shopDescription', 'shopMobileNumber', 'shopEmail', 'landmark', 'shopImageUrl'] as const;
    const normalizedData = {
      ...data,
      shopImageUrl: data.shopImageUrl ?? data.shopImage,
    };
    for (const key of EDITABLE) {
      if (normalizedData[key] !== undefined) {
        const v = String(normalizedData[key]).trim();
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
    const previousStatus = onboarding?.status ?? 'DRAFT';
    if (!onboarding) {
      onboarding = await SellerOnboarding.create({
        sellerId,
        shopType: 'Other',
        ...fields,
      });
    } else {
      Object.assign(onboarding, fields);
      if (!onboarding.shopType || !onboarding.shopType.trim()) {
        onboarding.shopType = 'Other';
      }
      await onboarding.save();
    }

    if (submit) {
      // Compliance gate — PAN, GSTIN and the FSSAI number+certificate are all
      // mandatory before an application can be submitted for review.
      const pan = String(onboarding.pan || '').trim().toUpperCase();
      const gstin = String(onboarding.gstin || '').trim().toUpperCase();
      const fssaiNumber = String(onboarding.fssaiNumber || '').trim();

      const errors: string[] = [];
      if (!pan) errors.push('PAN is required');
      else if (!PAN_RE.test(pan)) errors.push('PAN format is invalid');
      if (!gstin) errors.push('GSTIN is required');
      else if (!GSTIN_RE.test(gstin)) errors.push('GSTIN format is invalid');
      if (!fssaiNumber) errors.push('FSSAI number is required');
      else if (!FSSAI_RE.test(fssaiNumber)) errors.push('FSSAI number must be 14 digits');

      const fssaiCert = await SellerDocument.findOne({
        sellerId,
        documentType: 'FSSAI_CERTIFICATE',
        fileUrl: { $exists: true, $nin: [null, ''] },
      });
      if (!fssaiCert) errors.push('FSSAI certificate upload is required');

      // The shop photo is NOT part of onboarding — the seller adds it later from
      // Shop Settings (POST /seller/profile/photo). Not gated here.

      if (errors.length) {
        throw new AppError(errors.join('; '), 400);
      }

      onboarding.pan = pan;
      onboarding.gstin = gstin;
      onboarding.fssaiNumber = fssaiNumber;
      // If a shop image was uploaded anyway (e.g. an older client), keep it.
      const existingShopImage = await SellerDocument.findOne({
        sellerId,
        documentType: 'SHOP_IMAGE',
        fileUrl: { $exists: true, $nin: [null, ''] },
      });
      if (existingShopImage?.fileUrl) onboarding.shopImageUrl = existingShopImage.fileUrl;
      onboarding.status = 'PENDING_APPROVAL';
      onboarding.submittedAt = new Date();
      onboarding.adminComment = undefined;
      seller.onboardingStatus = 'PENDING_APPROVAL';
      // A rejected / changes-required seller who fixes and resubmits goes back
      // into the pending queue — clear the terminal REJECTED seller status.
      if (seller.status === 'REJECTED') seller.status = 'PENDING';
      await onboarding.save();
      await seller.save();
      await SellerApprovalHistory.create({
        sellerId,
        onboardingId: onboarding._id,
        action: previousStatus === 'DRAFT' ? 'SUBMITTED' : 'RESUBMITTED',
        previousStatus,
        newStatus: 'PENDING_APPROVAL',
        performedBy: seller.userId,
      });

      // Link the seller record onto the user Profile (best-effort).
      void linkSellerToUser(seller.userId, {
        sellerId: String(seller._id),
      });
    }

    return onboarding;
  }
}

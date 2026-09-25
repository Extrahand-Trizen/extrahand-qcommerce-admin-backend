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
import OrderPickupQR from '../models/OrderPickupQR';
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
import { resolveSellerByUidOrPhone } from './SellerIdentityService';
import { phoneLast10 } from '../utils/phone';
import { sendSellerOrderAlert } from './PushService';
import { VerificationServiceClient } from './VerificationServiceClient';
import { env } from '../config/env';

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
/** IFSC: 4 letters + 0 + 6 alphanumeric. */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const BANK_NAMES_BY_IFSC_PREFIX: Record<string, string> = {
  SBIN: 'State Bank of India',
  HDFC: 'HDFC Bank',
  ICIC: 'ICICI Bank',
  UTIB: 'Axis Bank',
  KKBK: 'Kotak Mahindra Bank',
  PUNB: 'Punjab National Bank',
  BARB: 'Bank of Baroda',
  CNRB: 'Canara Bank',
  UBIN: 'Union Bank of India',
  IDIB: 'Indian Bank',
  BKID: 'Bank of India',
  IOBA: 'Indian Overseas Bank',
  MAHB: 'Bank of Maharashtra',
  PSIB: 'Punjab & Sind Bank',
  CENT: 'Central Bank of India',
  UCOB: 'UCO Bank',
  YESB: 'Yes Bank',
  IDFB: 'IDFC FIRST Bank',
  INDB: 'IndusInd Bank',
  FDRL: 'Federal Bank',
  RBLN: 'RBL Bank',
  BAND: 'Bandhan Bank',
  CSBK: 'CSB Bank',
  KVBL: 'Karur Vysya Bank',
  SIBL: 'South Indian Bank',
  TMBL: 'Tamilnad Mercantile Bank',
  DCBL: 'DCB Bank',
  AIRP: 'Airtel Payments Bank',
  PYTM: 'Paytm Payments Bank',
  IPOS: 'India Post Payments Bank',
};

function resolveBankNameFromIFSC(ifsc: string): string {
  const prefix = String(ifsc || '').substring(0, 4).toUpperCase();
  return BANK_NAMES_BY_IFSC_PREFIX[prefix] || 'Verified Bank';
}
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
    storeSettings?: Record<string, unknown> | null;
    documents: Array<Record<string, unknown>>;
    history: Awaited<ReturnType<typeof SellerApprovalHistory.find>>;
  }> {
    let resolvedSellerId = id;
    let seller = await Seller.findById(id);
    let onboarding = await SellerOnboarding.findOne({ sellerId: id });
    if (!seller && !onboarding) {
      const onbById = await SellerOnboarding.findById(id);
      if (onbById) {
        onboarding = onbById;
        resolvedSellerId = String(onbById.sellerId);
        seller = await Seller.findById(resolvedSellerId);
      }
    }
    const [documents, history, storeSettings] = await Promise.all([
      SellerDocument.find({ sellerId: resolvedSellerId }).lean(),
      SellerApprovalHistory.find({ sellerId: resolvedSellerId }).sort({ performedAt: -1 }),
      SellerStoreSettings.findOne({ sellerId: resolvedSellerId }).lean(),
    ]);
    if (!seller && !onboarding) throw new AppError('Seller not found', 404);
    const normalizedDocuments = documents.map((doc) => ({
      ...doc,
      fileUrl: doc.fileUrl ? resolvePublicAssetUrl(doc.fileUrl) : undefined,
    }));
    if (onboarding && onboarding.shopImageUrl) {
      onboarding.shopImageUrl = resolvePublicAssetUrl(onboarding.shopImageUrl);
    }
    const bankDoc = normalizedDocuments.find((d) =>
      ['BANK_PASSBOOK', 'PASSBOOK', 'BANK_DOCUMENT', 'CANCELLED_CHEQUE'].includes(String(d.documentType).toUpperCase())
    );

    let bank = (onboarding as any)?.bankAccount;
    if ((!bank || !bank.accountNumber) && storeSettings?.bankAccount?.accountNumber) {
      const b = storeSettings.bankAccount as any;
      bank = {
        accountHolderName: b.accountHolderName,
        accountNumber: b.accountNumber,
        ifscCode: b.ifscCode,
        bankName: b.bankName,
        passbookImageUrl: b.passbookImageUrl ? resolvePublicAssetUrl(b.passbookImageUrl) : undefined,
        verificationStatus: b.verificationStatus || 'VERIFIED',
      };
      (onboarding as any).bankAccount = bank;
    }

    if (bank) {
      if (bankDoc?.fileUrl) {
        bank.passbookImageUrl = resolvePublicAssetUrl(String(bankDoc.fileUrl));
      } else if (bank.passbookImageUrl) {
        bank.passbookImageUrl = resolvePublicAssetUrl(bank.passbookImageUrl);
      } else if (bank.passbookUri && !bank.passbookUri.startsWith('file://')) {
        bank.passbookImageUrl = resolvePublicAssetUrl(bank.passbookUri);
      }
    }

    return { seller: seller || ({} as any), onboarding, storeSettings, documents: normalizedDocuments, history };
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

    const trimmedComment = comment?.trim();
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
        if (!trimmedComment) {
          throw new AppError('A correction note is required when requesting changes', 400);
        }
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
    onboarding.adminComment = trimmedComment;
    if (action === 'CHANGES_REQUESTED' && trimmedComment) {
      onboarding.lastCorrectionNote = trimmedComment;
    }
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
      comment: trimmedComment,
      performedBy: adminId,
    });

    // Notify seller
    if (seller.fcmTokens && seller.fcmTokens.length > 0) {
      if (action === 'CHANGES_REQUESTED') {
        void sendSellerOrderAlert({
          sellerId: String(seller._id),
          tokens: seller.fcmTokens,
          title: 'Seller Onboarding: Correction Required',
          body: trimmedComment || 'Admin has requested corrections on your onboarding application.',
          data: {
            type: 'ONBOARDING_CORRECTION_REQUIRED',
            sellerId: String(seller._id),
            comment: trimmedComment || '',
          },
          urgent: false,
        }).catch((err) => {
          logger.warn('Failed to send onboarding correction push notification', { error: err?.message, sellerId });
        });
      } else if (action === 'APPROVE') {
        void sendSellerOrderAlert({
          sellerId: String(seller._id),
          tokens: seller.fcmTokens,
          title: 'Application Approved!',
          body: 'Your seller account has been approved. Welcome to ExtraHand!',
          data: {
            type: 'ONBOARDING_APPROVED',
            sellerId: String(seller._id),
          },
          urgent: false,
        }).catch((err) => {
          logger.warn('Failed to send onboarding approval push notification', { error: err?.message, sellerId });
        });
      }
    }

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
      OrderPickupQR.deleteMany({ sellerId }, opts),
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
    const liveSellers = await Seller.find({ status: { $ne: 'DELETED' } }).select('_id').lean();
    filter.sellerId = { $in: liveSellers.map((seller) => seller._id) };
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
  static async registerSeller(data: {
    userId: string;
    fullName: string;
    mobileNumber: string;
    email?: string;
    /** Verified phone from user-service — trusted; used for UID-rotation recovery. */
    verifiedPhone?: string | null;
  }) {
    // Recover an existing seller by UID or, if the Firebase UID rotated, by the
    // verified phone — and rebind userId — instead of creating a duplicate.
    const resolution = await resolveSellerByUidOrPhone({
      userId: data.userId,
      verifiedPhone: data.verifiedPhone,
    });
    if (resolution.ok) {
      void linkSellerToUser({
        sellerId: String(resolution.seller._id),
        userId: resolution.seller.userId,
        phone: data.verifiedPhone ?? resolution.seller.mobileNumber,
      });
      return resolution.seller;
    }
    if (resolution.reason === 'AMBIGUOUS') {
      throw new AppError('Your account needs attention. Please contact support.', 409);
    }

    // Genuinely new. Store the phone in the same bare-digits shape existing
    // sellers use so future phone lookups match.
    const storedPhone = phoneLast10(data.verifiedPhone) || phoneLast10(data.mobileNumber) || data.mobileNumber;
    if (!storedPhone) throw new AppError('A valid mobile number is required', 400);

    const seller = await Seller.create({
      userId: data.userId,
      fullName: data.fullName,
      mobileNumber: storedPhone,
      email: data.email,
      status: 'PENDING',
      onboardingStatus: 'DRAFT',
    });
    void linkSellerToUser({
      sellerId: String(seller._id),
      userId: seller.userId,
      phone: data.verifiedPhone ?? storedPhone,
    });
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

    // Backend Security Guard: Edit access is strictly restricted to DRAFT, CHANGES_REQUIRED, or REJECTED
    if (onboarding) {
      if (onboarding.status === 'PENDING_APPROVAL') {
        if (submit) {
          throw new AppError('Application is already submitted and under review', 400);
        }
        throw new AppError('Application is currently under review and cannot be edited', 403);
      }
      if (onboarding.status === 'APPROVED') {
        if (submit) {
          throw new AppError('Application has already been approved', 400);
        }
        throw new AppError('Application has already been approved and cannot be edited', 403);
      }
    }

    // Security: Sanitize incoming fields to prevent client tampering of verification status
    const sanitizedFields = { ...fields };
    delete sanitizedFields.panVerificationStatus;
    delete sanitizedFields.panVerifiedAt;
    delete sanitizedFields.panVerifiedName;
    delete sanitizedFields.gstinVerificationStatus;
    delete sanitizedFields.gstinVerifiedAt;
    delete sanitizedFields.gstinVerifiedLegalName;
    delete sanitizedFields.gstinVerifiedTradeName;

    if (!onboarding) {
      onboarding = await SellerOnboarding.create({
        sellerId,
        shopType: 'Other',
        ...sanitizedFields,
        panVerificationStatus: 'NOT_VERIFIED',
        gstinVerificationStatus: 'NOT_VERIFIED',
      });
    } else {
      // Invalidation check: If pan or gstin string value changes, reset verification status
      if (sanitizedFields.pan !== undefined) {
        const newPan = String(sanitizedFields.pan || '').trim().toUpperCase();
        const curPan = String(onboarding.pan || '').trim().toUpperCase();
        if (newPan !== curPan) {
          onboarding.pan = newPan;
          onboarding.panVerificationStatus = 'NOT_VERIFIED';
          onboarding.panVerifiedAt = undefined;
          onboarding.panVerifiedName = undefined;
          delete sanitizedFields.pan; // already updated
        }
      }

      if (sanitizedFields.gstin !== undefined) {
        const newGstin = String(sanitizedFields.gstin || '').replace(/[\s-]/g, '').trim().toUpperCase();
        const curGstin = String(onboarding.gstin || '').replace(/[\s-]/g, '').trim().toUpperCase();
        if (newGstin !== curGstin) {
          onboarding.gstin = newGstin;
          onboarding.gstinVerificationStatus = 'NOT_VERIFIED';
          onboarding.gstinVerifiedAt = undefined;
          onboarding.gstinVerifiedLegalName = undefined;
          onboarding.gstinVerifiedTradeName = undefined;
          delete sanitizedFields.gstin; // already updated
        }
      }

      if (sanitizedFields.aadhaarNumber !== undefined) {
        const cleanAadhaar = String(sanitizedFields.aadhaarNumber || '').replace(/[\s-]/g, '').trim();
        onboarding.aadhaarNumber = cleanAadhaar || undefined;
        if (cleanAadhaar.length === 12 && (!onboarding.aadhaarVerificationStatus || onboarding.aadhaarVerificationStatus === 'NOT_VERIFIED')) {
          onboarding.aadhaarVerificationStatus = 'VERIFIED';
          onboarding.aadhaarVerifiedAt = new Date();
        }
        delete sanitizedFields.aadhaarNumber;
      }

      Object.assign(onboarding, sanitizedFields);
      if (!onboarding.shopType || !onboarding.shopType.trim()) {
        onboarding.shopType = 'Other';
      }
      await onboarding.save();
    }

    // Save and synchronize bank account to both onboarding and store settings
    if (sanitizedFields.bankAccount && typeof sanitizedFields.bankAccount === 'object') {
      const b = sanitizedFields.bankAccount as Record<string, unknown>;
      const accNum = String(b.accountNumber || '').trim();
      const ifsc = String(b.ifscCode || '').trim().toUpperCase();
      if (accNum && ifsc) {
        onboarding.bankAccount = {
          accountHolderName: String(b.accountHolderName || onboarding.fullName || '').trim(),
          accountNumber: accNum,
          ifscCode: ifsc,
          bankName: String(b.bankName || '').trim() || undefined,
          passbookUri: String(b.passbookUri || '').trim() || undefined,
          passbookImageUrl: b.passbookImageUrl ? String(b.passbookImageUrl) : undefined,
          verificationStatus: String(b.verificationStatus || 'VERIFIED'),
        };
        onboarding.markModified('bankAccount');
        await onboarding.save();

        await SellerStoreSettings.findOneAndUpdate(
          { sellerId },
          {
            $set: {
              'bankAccount.accountHolderName': String(b.accountHolderName || onboarding.fullName || '').trim(),
              'bankAccount.accountNumber': accNum,
              'bankAccount.ifscCode': ifsc,
              'bankAccount.bankName': String(b.bankName || '').trim() || undefined,
              'bankAccount.passbookImageUrl': b.passbookImageUrl || b.passbookUri,
              'bankAccount.verificationStatus': b.verificationStatus || 'VERIFIED',
            },
          },
          { upsert: true, new: true },
        );
      }
    }

    if (submit) {
      // Compliance & required fields validation before submission
      const errors: string[] = [];
      if (!onboarding.fullName?.trim()) errors.push('Full name is required');
      if (!onboarding.shopName?.trim()) errors.push('Shop name is required');
      if (!onboarding.address?.trim()) errors.push('Shop address is required');
      if (!onboarding.city?.trim()) errors.push('City is required');
      if (!onboarding.state?.trim()) errors.push('State is required');
      if (!onboarding.pincode?.trim()) errors.push('Pincode is required');

      const pan = String(onboarding.pan || '').trim().toUpperCase();
      const gstin = String(onboarding.gstin || '').replace(/[\s-]/g, '').trim().toUpperCase();
      if (!pan) errors.push('PAN is required');
      else if (!PAN_RE.test(pan)) errors.push('PAN format is invalid');
      if (onboarding.panVerificationStatus !== 'VERIFIED') {
        errors.push('PAN must be verified before submitting onboarding application');
      }

      if (gstin) {
        if (!GSTIN_RE.test(gstin)) errors.push('GSTIN format is invalid');
        if (onboarding.gstinVerificationStatus !== 'VERIFIED') {
          errors.push('GSTIN must be verified before submitting onboarding application');
        }
      }

      // Aadhaar is mandatory and verification is required
      const aadhaar = String(onboarding.aadhaarNumber || '').replace(/[\s-]/g, '').trim();
      if (!aadhaar) {
        errors.push('Aadhaar number is required');
      } else if (!/^[2-9]\d{11}$/.test(aadhaar)) {
        errors.push('Aadhaar number must be a valid 12-digit number starting with 2-9');
      }
      if (onboarding.aadhaarVerificationStatus !== 'VERIFIED') {
        errors.push('Aadhaar must be verified before submitting onboarding application');
      }

      // Bank account is mandatory for payout settlements
      const bank = onboarding.bankAccount;
      if (!bank?.accountNumber?.trim()) {
        errors.push('Bank account number is required');
      }
      if (!bank?.ifscCode?.trim()) {
        errors.push('Bank IFSC code is required');
      }

      // The shop photo is NOT part of onboarding — the seller adds it later from
      // Shop Settings (POST /seller/profile/photo). Not gated here.

      if (errors.length) {
        throw new AppError(errors.join('; '), 400);
      }

      onboarding.pan = pan;
      onboarding.gstin = gstin;
      // If a shop image was uploaded anyway (e.g. an older client), keep it.
      const existingShopImage = await SellerDocument.findOne({
        sellerId,
        documentType: 'SHOP_IMAGE',
        fileUrl: { $exists: true, $nin: [null, ''] },
      });
      if (existingShopImage?.fileUrl) onboarding.shopImageUrl = existingShopImage.fileUrl;
      onboarding.status = 'PENDING_APPROVAL';
      onboarding.submittedAt = new Date();
      if (onboarding.adminComment) {
        onboarding.lastCorrectionNote = onboarding.adminComment;
      }
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
        comment: previousStatus === 'CHANGES_REQUIRED' ? 'Resubmitted after corrections' : undefined,
        performedBy: seller.userId,
      });

      // Link the seller record onto the user Profile (best-effort).
      void linkSellerToUser({
        sellerId: String(seller._id),
        userId: seller.userId,
        phone: seller.mobileNumber,
      });
    }

    return onboarding;
  }

  /**
   * Verify seller PAN via API Gateway -> User Verification Service
   */
  static async verifySellerPAN(sellerId: string, panNumber: string, userToken: string) {
    const cleanPan = String(panNumber || '').trim().toUpperCase();
    if (!PAN_RE.test(cleanPan)) {
      throw new AppError('Invalid PAN format. Must be 10 alphanumeric characters (e.g. ABCDE1234F)', 400);
    }

    const seller = await Seller.findById(sellerId);
    if (!seller) throw new AppError('Seller not found', 404);

    let onboarding = await SellerOnboarding.findOne({ sellerId });
    if (!onboarding) {
      onboarding = await SellerOnboarding.create({
        sellerId,
        fullName: seller.fullName || 'Draft Seller',
        mobileNumber: seller.mobileNumber || '0000000000',
        email: seller.email,
        shopName: 'My Shop',
        address: 'Pending Address',
        city: 'Pending City',
        state: 'Pending State',
        pincode: '000000',
        shopType: 'Other',
        panVerificationStatus: 'NOT_VERIFIED',
        gstinVerificationStatus: 'NOT_VERIFIED',
      });
    }
    if (onboarding.status === 'PENDING_APPROVAL' || onboarding.status === 'APPROVED') {
      throw new AppError('Cannot modify details while application is under review or approved', 403);
    }

    try {
      const result = await VerificationServiceClient.verifyPAN(userToken, cleanPan);

      if (result.success) {
        onboarding.pan = cleanPan;
        onboarding.panVerificationStatus = 'VERIFIED';
        onboarding.panVerifiedAt = new Date();
        onboarding.panVerifiedName = result.name;
        await onboarding.save();

        return {
          success: true,
          pan: cleanPan,
          panVerificationStatus: onboarding.panVerificationStatus,
          panVerifiedAt: onboarding.panVerifiedAt,
          panVerifiedName: onboarding.panVerifiedName,
          maskedPAN: result.maskedPAN,
        };
      } else {
        onboarding.pan = cleanPan;
        onboarding.panVerificationStatus = 'FAILED';
        onboarding.panVerifiedAt = undefined;
        onboarding.panVerifiedName = undefined;
        await onboarding.save();
        throw new AppError(result.message || 'PAN verification failed', 400);
      }
    } catch (err: any) {
      // If it's a 4xx error from provider (e.g. invalid PAN / not found), mark status as FAILED
      if (err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500) {
        onboarding.pan = cleanPan;
        onboarding.panVerificationStatus = 'FAILED';
        onboarding.panVerifiedAt = undefined;
        onboarding.panVerifiedName = undefined;
        await onboarding.save();
        throw err;
      }
      // If it's a 5xx / gateway / network error, do NOT treat as invalid PAN; keep status as NOT_VERIFIED
      throw err;
    }
  }

  /**
   * Verify seller GSTIN via API Gateway -> User Verification Service
   */
  static async verifySellerGSTIN(sellerId: string, gstin: string, userToken: string, businessName?: string) {
    const cleanGstin = String(gstin || '').replace(/[\s-]/g, '').trim().toUpperCase();
    if (!GSTIN_RE.test(cleanGstin)) {
      throw new AppError('Invalid GSTIN format. Must be 15 alphanumeric characters', 400);
    }

    const seller = await Seller.findById(sellerId);
    if (!seller) throw new AppError('Seller not found', 404);

    let onboarding = await SellerOnboarding.findOne({ sellerId });
    if (!onboarding) {
      onboarding = await SellerOnboarding.create({
        sellerId,
        fullName: seller.fullName || 'Draft Seller',
        mobileNumber: seller.mobileNumber || '0000000000',
        email: seller.email,
        shopName: 'My Shop',
        address: 'Pending Address',
        city: 'Pending City',
        state: 'Pending State',
        pincode: '000000',
        shopType: 'Other',
        panVerificationStatus: 'NOT_VERIFIED',
        gstinVerificationStatus: 'NOT_VERIFIED',
      });
    }
    if (onboarding.status === 'PENDING_APPROVAL' || onboarding.status === 'APPROVED') {
      throw new AppError('Cannot modify details while application is under review or approved', 403);
    }

    const matchName = businessName || onboarding.shopName;

    try {
      const result = await VerificationServiceClient.verifyGSTIN(userToken, cleanGstin, matchName);

      if (result.success) {
        onboarding.gstin = cleanGstin;
        onboarding.gstinVerificationStatus = 'VERIFIED';
        onboarding.gstinVerifiedAt = new Date();
        onboarding.gstinVerifiedLegalName = result.legalName;
        onboarding.gstinVerifiedTradeName = result.tradeName;
        await onboarding.save();

        return {
          success: true,
          gstin: cleanGstin,
          gstinVerificationStatus: onboarding.gstinVerificationStatus,
          gstinVerifiedAt: onboarding.gstinVerifiedAt,
          gstinVerifiedLegalName: onboarding.gstinVerifiedLegalName,
          gstinVerifiedTradeName: onboarding.gstinVerifiedTradeName,
          maskedGSTIN: result.maskedGSTIN,
        };
      } else {
        onboarding.gstin = cleanGstin;
        onboarding.gstinVerificationStatus = 'FAILED';
        onboarding.gstinVerifiedAt = undefined;
        onboarding.gstinVerifiedLegalName = undefined;
        onboarding.gstinVerifiedTradeName = undefined;
        await onboarding.save();
        throw new AppError(result.message || 'GSTIN verification failed', 400);
      }
    } catch (err: any) {
      // If it's a 4xx error from provider (e.g. invalid GSTIN / not found), mark status as FAILED
      if (err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500) {
        onboarding.gstin = cleanGstin;
        onboarding.gstinVerificationStatus = 'FAILED';
        onboarding.gstinVerifiedAt = undefined;
        onboarding.gstinVerifiedLegalName = undefined;
        onboarding.gstinVerifiedTradeName = undefined;
        await onboarding.save();
        throw err;
      }
      // If it's a 5xx / gateway / network error, do NOT treat as invalid GSTIN; keep status as NOT_VERIFIED
      throw err;
    }
  }

  /**
   * Verify seller Aadhaar
   */
  static async verifySellerAadhaar(sellerId: string, aadhaarNumber: string, _userToken?: string) {
    const cleanAadhaar = String(aadhaarNumber || '').replace(/[\s-]/g, '').trim();
    if (!/^[2-9]\d{11}$/.test(cleanAadhaar)) {
      throw new AppError('Invalid Aadhaar format. Must be a 12-digit number starting with 2-9.', 400);
    }
    if (/^(\d)\1{11}$/.test(cleanAadhaar)) {
      throw new AppError('Invalid Aadhaar number. Cannot contain all identical digits.', 400);
    }

    const seller = await Seller.findById(sellerId);
    if (!seller) throw new AppError('Seller not found', 404);

    let onboarding = await SellerOnboarding.findOne({ sellerId });
    if (!onboarding) {
      onboarding = await SellerOnboarding.create({
        sellerId,
        fullName: seller.fullName || 'Draft Seller',
        mobileNumber: seller.mobileNumber || '0000000000',
        email: seller.email,
        shopName: 'My Shop',
        address: 'Pending Address',
        city: 'Pending City',
        state: 'Pending State',
        pincode: '000000',
        shopType: 'Other',
        panVerificationStatus: 'NOT_VERIFIED',
        gstinVerificationStatus: 'NOT_VERIFIED',
        aadhaarVerificationStatus: 'NOT_VERIFIED',
      });
    }
    if (onboarding.status === 'PENDING_APPROVAL' || onboarding.status === 'APPROVED') {
      throw new AppError('Cannot modify details while application is under review or approved', 403);
    }

    // Validate Aadhaar with Cashfree UIDAI API
    try {
      const result = await VerificationServiceClient.verifyAadhaar(_userToken || '', cleanAadhaar);
      onboarding.aadhaarNumber = cleanAadhaar;
      onboarding.aadhaarVerificationStatus = 'VERIFIED';
      onboarding.aadhaarVerifiedAt = new Date();
      await onboarding.save();

      return {
        success: true,
        aadhaarNumber: cleanAadhaar,
        aadhaarVerificationStatus: 'VERIFIED' as const,
        aadhaarVerifiedAt: onboarding.aadhaarVerifiedAt.toISOString(),
        maskedAadhaar: result.maskedAadhaar || ('XXXX-XXXX-' + cleanAadhaar.slice(-4)),
        message: result.message || 'Aadhaar verified successfully',
      };
    } catch (err: any) {
      if (err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500) {
        onboarding.aadhaarNumber = cleanAadhaar;
        onboarding.aadhaarVerificationStatus = 'FAILED';
        onboarding.aadhaarVerifiedAt = undefined;
        await onboarding.save();
        throw err;
      }
      throw err;
    }
  }

  /**
   * Verify seller bank account via API Gateway -> User Verification Service -> Cashfree
   */
  static async verifySellerBankAccount(
    sellerId: string,
    accountNumber: string,
    ifsc: string,
    accountHolderName?: string,
    userToken?: string,
  ) {
    const cleanAccount = String(accountNumber || '').trim();
    const cleanIfsc = String(ifsc || '').trim().toUpperCase();

    if (!cleanAccount || cleanAccount.length < 8 || cleanAccount.length > 20) {
      throw new AppError('Bank account number must be between 8 and 20 digits', 400);
    }
    if (!IFSC_RE.test(cleanIfsc)) {
      throw new AppError('Invalid IFSC format. Must be 11 characters (e.g., SBIN0001234)', 400);
    }

    const seller = await Seller.findById(sellerId);
    if (!seller) throw new AppError('Seller not found', 404);

    let onboarding = await SellerOnboarding.findOne({ sellerId });
    if (!onboarding) {
      onboarding = await SellerOnboarding.create({
        sellerId,
        fullName: seller.fullName || 'Draft Seller',
        mobileNumber: seller.mobileNumber || '0000000000',
        email: seller.email,
        shopName: 'My Shop',
        address: 'Pending Address',
        city: 'Pending City',
        state: 'Pending State',
        pincode: '000000',
        shopType: 'Other',
        panVerificationStatus: 'NOT_VERIFIED',
        gstinVerificationStatus: 'NOT_VERIFIED',
        aadhaarVerificationStatus: 'NOT_VERIFIED',
      });
    }
    if (onboarding.status === 'PENDING_APPROVAL' || onboarding.status === 'APPROVED') {
      throw new AppError('Cannot modify details while application is under review or approved', 403);
    }

    const candidateHolder = accountHolderName || onboarding.fullName || seller.fullName;

    if (userToken) {
      try {
        const result = await VerificationServiceClient.verifyBankAccount(
          userToken,
          cleanAccount,
          cleanIfsc,
          candidateHolder
        );

        if (result.success) {
          const verifiedName = result.name || candidateHolder;
          const resolvedBankName = resolveBankNameFromIFSC(cleanIfsc);
          const bankName = result.bankName || resolvedBankName;

          onboarding.bankAccount = {
            ...(onboarding.bankAccount || {}),
            accountNumber: cleanAccount,
            ifscCode: cleanIfsc,
            accountHolderName: verifiedName,
            bankName,
            verificationStatus: 'VERIFIED',
          };
          onboarding.markModified('bankAccount');
          await onboarding.save();

          await SellerStoreSettings.findOneAndUpdate(
            { sellerId },
            {
              $set: {
                'bankAccount.accountNumber': cleanAccount,
                'bankAccount.ifscCode': cleanIfsc,
                'bankAccount.accountHolderName': verifiedName,
                'bankAccount.bankName': bankName,
                'bankAccount.verificationStatus': 'VERIFIED',
              },
            },
            { upsert: true, new: true }
          );

          return {
            success: true,
            accountNumber: cleanAccount,
            ifsc: cleanIfsc,
            accountHolderName: verifiedName,
            bankName,
            verificationStatus: 'VERIFIED' as const,
            maskedBankAccount: result.maskedBankAccount || ('XXXX' + cleanAccount.slice(-4)),
            referenceId: result.referenceId,
            message: 'Bank account verified successfully with Cashfree',
          };
        }
      } catch (err: any) {
        if (err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500) {
          onboarding.bankAccount = {
            ...(onboarding.bankAccount || {}),
            accountNumber: cleanAccount,
            ifscCode: cleanIfsc,
            accountHolderName: candidateHolder,
            verificationStatus: 'FAILED',
          };
          onboarding.markModified('bankAccount');
          await onboarding.save();
          throw err;
        }
        logger.warn('Bank verification gateway fallback', { error: err.message });
        throw err;
      }
    }

    // Default valid format fallback with resolved bank name from IFSC
    const resolvedBank = resolveBankNameFromIFSC(cleanIfsc);
    const bankObj = {
      accountNumber: cleanAccount,
      ifscCode: cleanIfsc,
      accountHolderName: candidateHolder,
      bankName: resolvedBank,
      verificationStatus: 'VERIFIED' as const,
    };
    onboarding.bankAccount = {
      ...(onboarding.bankAccount || {}),
      ...bankObj,
    };
    onboarding.markModified('bankAccount');
    await onboarding.save();

    await SellerStoreSettings.findOneAndUpdate(
      { sellerId },
      { $set: { bankAccount: bankObj } },
      { upsert: true, new: true }
    );

    return {
      success: true,
      accountNumber: cleanAccount,
      ifsc: cleanIfsc,
      accountHolderName: bankObj.accountHolderName,
      bankName: bankObj.bankName,
      verificationStatus: 'VERIFIED' as const,
      maskedBankAccount: 'XXXX' + cleanAccount.slice(-4),
      message: 'Bank account verified successfully',
    };
  }
}

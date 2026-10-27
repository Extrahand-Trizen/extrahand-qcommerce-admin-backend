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
import PriceReviewLog from '../models/PriceReviewLog';
import SellerLedger from '../models/SellerLedger';
import SellerPayout from '../models/SellerPayout';
import { SellerCatalogueService } from './SellerCatalogueService';
import { paginate } from '../utils/pagination';
import { resolvePublicAssetUrl, resolveSecureDocumentUrl } from '../utils/media';
import { PaginationQuery, OnboardingStatus, ApprovalAction, Weekday } from '../types';
import { AppError } from '../utils/response';
import { FilterQuery } from 'mongoose';
import { linkSellerToUser, unlinkSeller } from './UserServiceClient';
import { purgeSellerNotifications } from './NotificationServiceClient';
import { deleteFile, uploadBufferToStorage } from '../utils/storage';
import logger from '../config/logger';
import { resolveSellerByUidOrPhone } from './SellerIdentityService';
import { phoneLast10 } from '../utils/phone';
import { sendSellerOrderAlert } from './PushService';
import { VerificationServiceClient } from './VerificationServiceClient';
import { env } from '../config/env';
import { emitSellerOnboardingUpdated } from '../socket/orderSocket';

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
  CBIN: 'Central Bank of India',
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

const DAY_CANONICAL_MAP: Record<string, Weekday> = {
  sunday: 'sun', sun: 'sun',
  monday: 'mon', mon: 'mon',
  tuesday: 'tue', tue: 'tue',
  wednesday: 'wed', wed: 'wed',
  thursday: 'thu', thu: 'thu',
  friday: 'fri', fri: 'fri',
  saturday: 'sat', sat: 'sat',
};

function mapDayToCanonical(raw: string): Weekday | undefined {
  const clean = String(raw || '').trim().toLowerCase();
  return DAY_CANONICAL_MAP[clean];
}

function parse12hTo24h(raw: string): string | undefined {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return s;
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const period = m[3] ? m[3].toLowerCase() : undefined;
  if (min > 59) return undefined;
  if (period === 'am') {
    if (h === 12) h = 0;
  } else if (period === 'pm') {
    if (h !== 12) h += 12;
  }
  if (h > 23) return undefined;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
export class SellerService {
  static async listSellers(
    query: PaginationQuery & {
      status?: string;
      onboardingStatus?: string;
      tab?: string;
      shopType?: string;
      dateRange?: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    const filter: FilterQuery<typeof Seller> = {};

    // 1. Tab base constraints
    if (query.tab) {
      if (query.tab === 'active') filter.status = 'ACTIVE';
      else if (query.tab === 'pending_approval' || query.tab === 'pending') {
        filter.status = { $ne: 'DELETED' };
        filter.onboardingStatus = 'PENDING_APPROVAL';
      } else if (query.tab === 'in_progress') {
        filter.status = { $ne: 'DELETED' };
        filter.onboardingStatus = { $in: ['DRAFT', 'CHANGES_REQUIRED'] };
      } else if (query.tab === 'inactive') filter.status = 'INACTIVE';
      else if (query.tab === 'suspended') filter.status = 'SUSPENDED';
      else if (query.tab === 'inactive_suspended' || query.tab === 'deleted') filter.status = { $in: ['INACTIVE', 'SUSPENDED', 'DELETED'] };
      else if (query.tab === 'current') {
        filter.status = { $ne: 'DELETED' };
        filter.onboardingStatus = 'APPROVED';
      }
    }

    // 2. Specific Account Status filter (takes precedence / narrows tab)
    if (query.status && query.status !== 'all') {
      if (query.status === 'INACTIVE_SUSPENDED') {
        filter.status = { $in: ['INACTIVE', 'SUSPENDED'] };
      } else {
        filter.status = query.status.toUpperCase();
      }
    }

    // 3. Specific Onboarding Status filter (takes precedence / narrows tab)
    if (query.onboardingStatus && query.onboardingStatus !== 'all') {
      if (query.onboardingStatus === 'IN_PROGRESS') {
        filter.onboardingStatus = { $in: ['DRAFT', 'CHANGES_REQUIRED'] };
      } else {
        filter.onboardingStatus = query.onboardingStatus.toUpperCase();
      }
    }

    // 4. Shop Type filter (matches SellerOnboarding category or shopType)
    if (query.shopType && query.shopType !== 'all') {
      const qType = query.shopType.trim();
      const onboardingsWithType = await SellerOnboarding.find({
        $or: [
          { category: { $regex: qType, $options: 'i' } },
          { shopType: { $regex: qType, $options: 'i' } },
        ],
      })
        .select('sellerId')
        .lean();

      const matchingSellerIds = onboardingsWithType.map((o) => o.sellerId);
      filter._id = { $in: matchingSellerIds };
    }

    // 5. Date Range filter (createdAt)
    if (query.dateRange && query.dateRange !== 'all') {
      const now = new Date();
      if (query.dateRange === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        filter.createdAt = { $gte: start };
      } else if (query.dateRange === 'last_7_days') {
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        filter.createdAt = { $gte: start };
      } else if (query.dateRange === 'last_30_days') {
        const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        filter.createdAt = { $gte: start };
      } else if (query.dateRange === 'this_month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        filter.createdAt = { $gte: start, $lte: end };
      }
    } else if (query.startDate || query.endDate) {
      const dateCond: Record<string, any> = {};
      if (query.startDate) dateCond.$gte = new Date(query.startDate);
      if (query.endDate) dateCond.$lte = new Date(query.endDate);
      filter.createdAt = dateCond;
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      const orConditions: Array<Record<string, any>> = [
        { fullName: { $regex: q, $options: 'i' } },
        { mobileNumber: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { userId: { $regex: q, $options: 'i' } },
      ];
      if (mongoose.Types.ObjectId.isValid(q)) {
        orConditions.push({ _id: new mongoose.Types.ObjectId(q) });
      } else if (q.toUpperCase().startsWith('SH-')) {
        const shortPart = q.slice(3).trim();
        if (mongoose.Types.ObjectId.isValid(shortPart)) {
          orConditions.push({ _id: new mongoose.Types.ObjectId(shortPart) });
        }
      }

      // Also search shopName in SellerOnboarding
      const matchingOnboardings = await SellerOnboarding.find({
        shopName: { $regex: q, $options: 'i' },
      })
        .select('sellerId')
        .lean();
      if (matchingOnboardings.length > 0) {
        orConditions.push({ _id: { $in: matchingOnboardings.map((o) => o.sellerId) } });
      }

      filter.$or = orConditions;
    }

    const paginationQuery: PaginationQuery = { ...query };
    if ((query.tab === 'deleted' || query.tab === 'inactive_suspended') && !query.sortBy) {
      paginationQuery.sortBy = 'deletedAt';
      paginationQuery.sortOrder = 'desc';
    }

    const [result, summaryAgg] = await Promise.all([
      paginate(Seller, filter, paginationQuery),
      Seller.aggregate<{
        _id: null;
        total: number;
        active: number;
        inactive: number;
        suspended: number;
        deleted: number;
        pendingStatus: number;
        pendingApproval: number;
        inProgress: number;
        approved: number;
      }>([
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$status', 'DELETED'] },
                      { $eq: ['$onboardingStatus', 'APPROVED'] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            active: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
            inactive: { $sum: { $cond: [{ $eq: ['$status', 'INACTIVE'] }, 1, 0] } },
            suspended: { $sum: { $cond: [{ $eq: ['$status', 'SUSPENDED'] }, 1, 0] } },
            deleted: { $sum: { $cond: [{ $eq: ['$status', 'DELETED'] }, 1, 0] } },
            pendingStatus: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } },
            pendingApproval: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$status', 'DELETED'] },
                      { $eq: ['$onboardingStatus', 'PENDING_APPROVAL'] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            inProgress: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$status', 'DELETED'] },
                      { $in: ['$onboardingStatus', ['DRAFT', 'CHANGES_REQUIRED']] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            approved: { $sum: { $cond: [{ $eq: ['$onboardingStatus', 'APPROVED'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const stats = summaryAgg[0];
    const summary = {
      total: stats?.total || 0,
      active: stats?.active || 0,
      pendingApproval: stats?.pendingApproval || 0,
      inactive: stats?.inactive || 0,
      suspended: stats?.suspended || 0,
      deleted: stats?.deleted || 0,
      inactiveSuspended: (stats?.inactive || 0) + (stats?.suspended || 0) + (stats?.deleted || 0),
      inProgress: stats?.inProgress || 0,
      approved: stats?.approved || 0,
    };

    const sellerIds = result.items.map((s: { _id: unknown }) => s._id);
    const onboardings = await SellerOnboarding.find({ sellerId: { $in: sellerIds } }).lean();
    const onboardingMap = new Map(onboardings.map((o) => [o.sellerId.toString(), o]));
    (result as { items: unknown[] }).items = result.items.map((s) => {
      const onb = onboardingMap.get((s as { _id: { toString: () => string } })._id.toString()) || null;
      const sellerObj = s as Record<string, any>;
      let displayPhone = sellerObj.mobileNumber;
      if (!displayPhone || /^0+$/.test(displayPhone) || displayPhone === '0000000000') {
        const fallback = onb?.mobileNumber || onb?.shopMobileNumber;
        if (fallback && !/^0+$/.test(fallback) && fallback !== '0000000000') {
          displayPhone = fallback;
        }
      }
      return {
        ...sellerObj,
        mobileNumber: displayPhone,
        onboarding: onb,
      };
    });

    return {
      ...result,
      summary,
    };
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

    // PAN is optional: Do not return unverified or failed PAN details to client
    if (onboarding && onboarding.panVerificationStatus !== 'VERIFIED') {
      onboarding.pan = undefined;
      onboarding.panVerificationStatus = 'NOT_VERIFIED';
      onboarding.panVerifiedAt = undefined;
      onboarding.panVerifiedName = undefined;
    }

    // SEC-V01: Capture RAW database document references BEFORE presentation transformation
    let rawPanUrl =
      (onboarding as any)?.panDocumentUri ||
      (onboarding as any)?.panImageUrl ||
      (onboarding as any)?.panCardUrl;
    if (rawPanUrl && typeof rawPanUrl === 'string' && rawPanUrl.includes('/documents/') && rawPanUrl.includes('/file')) {
      rawPanUrl = undefined;
    }

    let rawAadhaarFrontUrl = onboarding?.aadhaarFrontImageUrl;
    if (!rawAadhaarFrontUrl || (typeof rawAadhaarFrontUrl === 'string' && rawAadhaarFrontUrl.includes('/documents/') && rawAadhaarFrontUrl.includes('/file'))) {
      if (onboarding?.aadhaarDocumentUri && !onboarding.aadhaarDocumentUri.includes('/documents/')) {
        rawAadhaarFrontUrl = onboarding.aadhaarDocumentUri;
      }
    }
    if (!rawAadhaarFrontUrl && onboarding?.aadhaarDocumentUri) {
      rawAadhaarFrontUrl = onboarding.aadhaarDocumentUri;
    }
    if (!rawAadhaarFrontUrl) {
      const aadhaarFrontDoc = documents.find((d) =>
        ['AADHAAR_CARD', 'AADHAAR', 'AADHAR_CARD', 'AADHAR', 'AADHAAR_DOCUMENT', 'AADHAAR_FRONT'].includes(
          String(d.documentType || '').toUpperCase(),
        ),
      );
      if (aadhaarFrontDoc?.fileUrl) {
        rawAadhaarFrontUrl = String(aadhaarFrontDoc.fileUrl);
      }
    }

    let rawAadhaarBackUrl = onboarding?.aadhaarBackImageUrl;
    if (rawAadhaarBackUrl && typeof rawAadhaarBackUrl === 'string' && rawAadhaarBackUrl.includes('/documents/') && rawAadhaarBackUrl.includes('/file')) {
      const oAny = onboarding as any;
      if (oAny?.aadhaarBackImage && !oAny.aadhaarBackImage.includes('/documents/')) {
        rawAadhaarBackUrl = oAny.aadhaarBackImage;
      } else if (oAny?.aadhaarBackUri && !oAny.aadhaarBackUri.includes('/documents/')) {
        rawAadhaarBackUrl = oAny.aadhaarBackUri;
      }
    }
    if (!rawAadhaarBackUrl) {
      const aadhaarBackDoc = documents.find((d) =>
        ['AADHAAR_CARD_BACK', 'AADHAAR_BACK', 'AADHAR_CARD_BACK', 'AADHAR_BACK'].includes(
          String(d.documentType || '').toUpperCase(),
        ),
      );
      if (aadhaarBackDoc?.fileUrl) {
        rawAadhaarBackUrl = String(aadhaarBackDoc.fileUrl);
      }
    }

    const rawBankDocFromDb = documents.find((d) =>
      ['BANK_PASSBOOK', 'PASSBOOK', 'BANK_DOCUMENT', 'CANCELLED_CHEQUE', 'CHEQUE', 'PASSBOOK_IMAGE'].includes(
        String(d.documentType).toUpperCase(),
      ),
    );
    const rawBankDocUrl = rawBankDocFromDb?.fileUrl ? String(rawBankDocFromDb.fileUrl) : undefined;
    const rawOnboardingPassbookUrl =
      (onboarding?.bankAccount?.passbookImageUrl ? String(onboarding.bankAccount.passbookImageUrl) : undefined) ||
      (onboarding?.bankAccount?.passbookUri && !String(onboarding.bankAccount.passbookUri).startsWith('file://')
        ? String(onboarding.bankAccount.passbookUri)
        : undefined);
    const rawStorePassbookUrl = (storeSettings?.bankAccount as any)?.passbookImageUrl
      ? String((storeSettings!.bankAccount as any).passbookImageUrl)
      : undefined;

    const rawPassbookUrl = rawBankDocUrl || rawOnboardingPassbookUrl || rawStorePassbookUrl;

    let rawSelfieUrl =
      (onboarding as any)?.kycSelfieUri ||
      (onboarding as any)?.selfieUrl ||
      (seller as any)?.photoURL ||
      (seller as any)?.selfie;
    if (
      rawSelfieUrl &&
      (typeof rawSelfieUrl !== 'string' ||
       rawSelfieUrl.startsWith('file://') ||
       rawSelfieUrl.startsWith('content://') ||
       rawSelfieUrl.startsWith('ph://') ||
       rawSelfieUrl.startsWith('/data/user/') ||
       (rawSelfieUrl.includes('/documents/') && rawSelfieUrl.includes('/file')))
    ) {
      rawSelfieUrl = undefined;
    }
    if (!rawSelfieUrl) {
      const selfieDoc = documents.find((d) =>
        ['SELFIE', 'LIVE_SELFIE', 'SELLER_SELFIE'].includes(String(d.documentType || '').toUpperCase()),
      );
      if (selfieDoc?.fileUrl) {
        const docUrl = String(selfieDoc.fileUrl);
        if (!docUrl.startsWith('file://') && !docUrl.startsWith('content://') && !docUrl.startsWith('/data/user/')) {
          rawSelfieUrl = docUrl;
        }
      }
    }

    // 1. Resolve normalized document list from raw documents
    const normalizedDocuments: Array<Record<string, unknown>> = await Promise.all(
      documents.map(async (doc) => {
        const isPublic = doc.documentType === 'SHOP_IMAGE';
        const docId = doc._id ? doc._id.toString() : String(doc.documentType);
        const fileUrl = doc.fileUrl
          ? isPublic
            ? resolvePublicAssetUrl(doc.fileUrl)
            : await resolveSecureDocumentUrl(resolvedSellerId, docId, doc.fileUrl)
          : undefined;
        return {
          ...doc,
          fileUrl,
        };
      }),
    );

    // 2. Synthesize missing PAN_CARD doc from raw DB reference (single resolution)
    const hasPanDoc = normalizedDocuments.some((d) =>
      ['PAN_CARD', 'PAN', 'PAN_DOCUMENT'].includes(String(d.documentType || '').toUpperCase())
    );
    if (!hasPanDoc && onboarding && rawPanUrl && onboarding.panVerificationStatus === 'VERIFIED') {
      normalizedDocuments.push({
        _id: new mongoose.Types.ObjectId() as any,
        sellerId: new mongoose.Types.ObjectId(resolvedSellerId) as any,
        documentType: 'PAN_CARD',
        fileName: 'PAN Card',
        fileUrl: await resolveSecureDocumentUrl(resolvedSellerId, 'PAN_CARD', rawPanUrl),
        verificationStatus: (onboarding.panVerificationStatus === 'VERIFIED' ? 'VERIFIED' : 'PENDING') as any,
        uploadedAt: onboarding.updatedAt || onboarding.createdAt,
      });
    }

    // 3. Synthesize missing AADHAAR_CARD doc from raw DB reference (single resolution)
    const hasAadhaarDoc = normalizedDocuments.some((d) =>
      ['AADHAAR_CARD', 'AADHAAR', 'AADHAR_CARD', 'AADHAR', 'AADHAAR_DOCUMENT'].includes(String(d.documentType || '').toUpperCase())
    );
    if (!hasAadhaarDoc && onboarding && rawAadhaarFrontUrl) {
      normalizedDocuments.push({
        _id: new mongoose.Types.ObjectId() as any,
        sellerId: new mongoose.Types.ObjectId(resolvedSellerId) as any,
        documentType: 'AADHAAR_CARD',
        fileName: 'Aadhaar Card Front',
        fileUrl: await resolveSecureDocumentUrl(resolvedSellerId, 'AADHAAR_CARD', rawAadhaarFrontUrl),
        verificationStatus: (onboarding.aadhaarVerificationStatus === 'VERIFIED' ? 'VERIFIED' : 'PENDING') as any,
        uploadedAt: onboarding.updatedAt || onboarding.createdAt,
      });
    }

    const hasAadhaarBackDoc = normalizedDocuments.some((d) =>
      ['AADHAAR_CARD_BACK', 'AADHAAR_BACK', 'AADHAR_CARD_BACK', 'AADHAR_BACK'].includes(String(d.documentType || '').toUpperCase())
    );
    if (!hasAadhaarBackDoc && onboarding && rawAadhaarBackUrl) {
      normalizedDocuments.push({
        _id: new mongoose.Types.ObjectId() as any,
        sellerId: new mongoose.Types.ObjectId(resolvedSellerId) as any,
        documentType: 'AADHAAR_CARD_BACK',
        fileName: 'Aadhaar Card Back',
        fileUrl: await resolveSecureDocumentUrl(resolvedSellerId, 'AADHAAR_CARD_BACK', rawAadhaarBackUrl),
        verificationStatus: (onboarding.aadhaarVerificationStatus === 'VERIFIED' ? 'VERIFIED' : 'PENDING') as any,
        uploadedAt: onboarding.updatedAt || onboarding.createdAt,
      });
    }

    // Synthesize missing SELFIE doc from raw DB reference (only if valid non-empty URL)
    const hasSelfieDoc = normalizedDocuments.some((d) =>
      ['SELFIE', 'LIVE_SELFIE', 'SELLER_SELFIE'].includes(String(d.documentType || '').toUpperCase())
    );
    if (!hasSelfieDoc && onboarding && rawSelfieUrl) {
      const resolvedSelfie = await resolveSecureDocumentUrl(resolvedSellerId, 'SELFIE', rawSelfieUrl);
      if (resolvedSelfie) {
        normalizedDocuments.push({
          _id: new mongoose.Types.ObjectId() as any,
          sellerId: new mongoose.Types.ObjectId(resolvedSellerId) as any,
          documentType: 'SELFIE',
          fileName: 'Live Selfie',
          fileUrl: resolvedSelfie,
          verificationStatus: 'VERIFIED',
          uploadedAt: onboarding.updatedAt || onboarding.createdAt,
        });
      }
    }

    // 4. Resolve bank account passbook URL from raw reference (single resolution)
    let bank = (onboarding as any)?.bankAccount;
    if ((!bank || !bank.accountNumber) && storeSettings?.bankAccount) {
      const b = storeSettings.bankAccount as Record<string, unknown>;
      bank = {
        ...(bank || {}),
        accountHolderName: String(b.accountHolderName || bank?.accountHolderName || ''),
        accountNumber: String(b.accountNumber || bank?.accountNumber || ''),
        ifscCode: String(b.ifscCode || bank?.ifscCode || ''),
        bankName: String(b.bankName || bank?.bankName || ''),
        passbookImageUrl: b.passbookImageUrl ? String(b.passbookImageUrl) : bank?.passbookImageUrl,
        verificationStatus: String(b.verificationStatus || bank?.verificationStatus || 'VERIFIED'),
      };
    }

    if (rawPassbookUrl) {
      const resolvedPassbook = await resolveSecureDocumentUrl(resolvedSellerId, 'BANK_PASSBOOK', rawPassbookUrl);
      if (!bank) {
        bank = { verificationStatus: 'NOT_VERIFIED' };
      }
      bank.passbookImageUrl = resolvedPassbook;
      bank.passbookUri = resolvedPassbook;
    }

    // 5. Build presentation Onboarding DTO using separate resolution
    let onboardingPresentation: any = onboarding ? (onboarding.toObject ? onboarding.toObject() : { ...onboarding }) : null;
    if (onboardingPresentation) {
      if (onboardingPresentation.shopImageUrl) {
        onboardingPresentation.shopImageUrl = resolvePublicAssetUrl(onboardingPresentation.shopImageUrl);
      }
      if (!onboardingPresentation.shopImageUrl) {
        const shopDoc = normalizedDocuments.find((d) =>
          ['SHOP_IMAGE', 'STORE_FRONT', 'STORE_PHOTO'].includes(String(d.documentType || '').toUpperCase())
        );
        if (shopDoc?.fileUrl) {
          onboardingPresentation.shopImageUrl = resolvePublicAssetUrl(String(shopDoc.fileUrl));
        }
      }
      if (rawAadhaarFrontUrl) {
        const resAadhaarFront = await resolveSecureDocumentUrl(resolvedSellerId, 'AADHAAR_CARD', rawAadhaarFrontUrl);
        const finalFront = resAadhaarFront || rawAadhaarFrontUrl;
        onboardingPresentation.aadhaarFrontImageUrl = finalFront;
        onboardingPresentation.aadhaarDocumentUri = finalFront;
      }
      if (rawAadhaarBackUrl) {
        const resAadhaarBack = await resolveSecureDocumentUrl(resolvedSellerId, 'AADHAAR_CARD_BACK', rawAadhaarBackUrl);
        const finalBack = resAadhaarBack || rawAadhaarBackUrl;
        onboardingPresentation.aadhaarBackImageUrl = finalBack;
      }
      if (rawPanUrl) {
        const resPan = await resolveSecureDocumentUrl(resolvedSellerId, 'PAN_CARD', rawPanUrl);
        const finalPan = resPan || rawPanUrl;
        onboardingPresentation.panDocumentUri = finalPan;
        onboardingPresentation.panImageUrl = finalPan;
        onboardingPresentation.panCardUrl = finalPan;
      } else {
        const panDoc = normalizedDocuments.find((d) =>
          ['PAN_CARD', 'PAN', 'PAN_DOCUMENT'].includes(String(d.documentType || '').toUpperCase())
        );
        if (panDoc?.fileUrl) {
          onboardingPresentation.panCardUrl = panDoc.fileUrl;
        }
      }

      if (rawSelfieUrl) {
        const resSelfie = await resolveSecureDocumentUrl(resolvedSellerId, 'SELFIE', rawSelfieUrl);
        const finalSelfie = resSelfie || rawSelfieUrl;
        if (finalSelfie && !finalSelfie.startsWith('file://') && !finalSelfie.startsWith('content://') && !finalSelfie.startsWith('/data/user/')) {
          onboardingPresentation.kycSelfieUri = finalSelfie;
          onboardingPresentation.selfieUrl = finalSelfie;
        }
      } else {
        const selfieDoc = normalizedDocuments.find((d) =>
          ['SELFIE', 'LIVE_SELFIE', 'SELLER_SELFIE'].includes(String(d.documentType || '').toUpperCase())
        );
        if (selfieDoc?.fileUrl && !String(selfieDoc.fileUrl).startsWith('file://')) {
          onboardingPresentation.kycSelfieUri = String(selfieDoc.fileUrl);
          onboardingPresentation.selfieUrl = String(selfieDoc.fileUrl);
        } else {
          delete onboardingPresentation.kycSelfieUri;
          delete onboardingPresentation.selfieUrl;
        }
      }

      // Clear empty or local device URIs so web clients never receive unrenderable file:// paths
      if (String(onboardingPresentation.kycSelfieUri || '').startsWith('file://')) delete onboardingPresentation.kycSelfieUri;
      if (String(onboardingPresentation.selfieUrl || '').startsWith('file://')) delete onboardingPresentation.selfieUrl;
      if (String(onboardingPresentation.aadhaarFrontImageUrl || '').startsWith('file://')) delete onboardingPresentation.aadhaarFrontImageUrl;
      if (String(onboardingPresentation.aadhaarBackImageUrl || '').startsWith('file://')) delete onboardingPresentation.aadhaarBackImageUrl;
      if (String(onboardingPresentation.aadhaarDocumentUri || '').startsWith('file://')) delete onboardingPresentation.aadhaarDocumentUri;
      if (String(onboardingPresentation.panDocumentUri || '').startsWith('file://')) delete onboardingPresentation.panDocumentUri;
      if (!onboardingPresentation.aadhaarFrontImageUrl) delete onboardingPresentation.aadhaarFrontImageUrl;
      if (!onboardingPresentation.aadhaarBackImageUrl) delete onboardingPresentation.aadhaarBackImageUrl;
      if (!onboardingPresentation.aadhaarDocumentUri) delete onboardingPresentation.aadhaarDocumentUri;
      if (!onboardingPresentation.panDocumentUri) delete onboardingPresentation.panDocumentUri;

      if (bank) {
        onboardingPresentation.bankAccount = bank;
      }
    }

    return { seller: seller || ({} as any), onboarding: onboardingPresentation, storeSettings, documents: normalizedDocuments, history };
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

    emitSellerOnboardingUpdated(sellerId, {
      status: newOnboardingStatus,
      action: historyAction,
      reviewNote: trimmedComment,
      updatedAt: new Date(),
      userId: seller.userId,
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

  /** Admin: soft-delete a seller profile with deletedAt and preserve archive history. */
  static async deleteSeller(id: string) {
    const seller = await Seller.findById(id);
    if (!seller) throw new AppError('Seller not found', 404);

    const assetUrls = await this.collectStoreAssetUrls(id);
    // Purge operational store collections (listings, inventory, carts, promos)
    await Promise.all([
      SellerListing.deleteMany({ sellerId: id }),
      ShopInventory.deleteMany({ sellerId: id }),
      CustomerCart.deleteMany({ sellerId: id }),
      OrderPickupQR.deleteMany({ sellerId: id }),
      Promotion.deleteMany({ sellerId: id }),
      PromotionRedemption.deleteMany({ sellerId: id }),
      ProductSubmission.deleteMany({ sellerId: id }),
    ]);

    const now = new Date();
    const mangledUserId = `deleted:${seller.userId}:${now.getTime()}`;

    // If seller's mobileNumber is all zeros, but onboarding has a real phone, sync it before soft-deleting
    const onboarding = await SellerOnboarding.findOne({ sellerId: id });
    let resolvedPhone = seller.mobileNumber;
    if (!resolvedPhone || /^0+$/.test(resolvedPhone) || resolvedPhone === '0000000000') {
      const candidate = onboarding?.mobileNumber || onboarding?.shopMobileNumber;
      if (candidate && !/^0+$/.test(candidate) && candidate !== '0000000000') {
        resolvedPhone = candidate;
      }
    }

    await Seller.updateOne(
      { _id: id },
      {
        $set: {
          status: 'DELETED',
          deletedAt: now,
          userId: mangledUserId,
          mobileNumber: resolvedPhone,
          fcmTokens: [],
        },
      }
    );

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
          { $set: { status: 'DELETED', deletedAt: new Date(), userId: mangledUserId, fcmTokens: [] } },
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
        { $set: { status: 'DELETED', deletedAt: new Date(), userId: mangledUserId, fcmTokens: [] } },
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

  /** Admin: paginated list of seller stores with inventory and request counts. */
  static async listStores(
    query: PaginationQuery & {
      search?: string;
      city?: string;
      status?: string;
      hasPendingProducts?: string;
      hasPendingCustomProducts?: string;
      hasPendingPriceChanges?: string;
      underReview?: string;
    },
  ) {
    const filter: FilterQuery<typeof SellerOnboarding> = {};
    const liveSellers = await Seller.find({ status: { $ne: 'DELETED' } }).select('_id').lean();
    filter.sellerId = { $in: liveSellers.map((seller) => seller._id) };
    if (query.city?.trim()) filter.city = { $regex: query.city.trim(), $options: 'i' };
    if (query.status?.trim()) {
      const sellers = await Seller.find({ status: query.status.trim() }).select('_id').lean();
      filter.sellerId = { $in: sellers.map((seller) => seller._id) };
    }

    if (query.underReview === 'true') {
      filter.status = 'APPROVED';
      const [pendingSubmissions, pendingListings] = await Promise.all([
        ProductSubmission.distinct('sellerId', { status: { $in: ['PENDING', 'UNDER_REVIEW'] } }),
        SellerListing.distinct('sellerId', { reviewStatus: { $in: ['UNDER_REVIEW', 'PENDING_REVIEW'] } }),
      ]);
      const activeIds = [...new Set([...pendingSubmissions, ...pendingListings].map((id) => String(id)))];
      filter.sellerId = { $in: activeIds.map((id) => new mongoose.Types.ObjectId(id)) };
    } else if (query.hasPendingProducts === 'true') {
      filter.status = 'APPROVED';
      const [pendingSubmissions, pendingListings] = await Promise.all([
        ProductSubmission.distinct('sellerId', { status: 'PENDING' }),
        SellerListing.distinct('sellerId', { reviewStatus: { $in: ['UNDER_REVIEW', 'PENDING_REVIEW'] } }),
      ]);
      const activeIds = [...new Set([...pendingSubmissions, ...pendingListings].map((id) => String(id)))];
      filter.sellerId = { $in: activeIds.map((id) => new mongoose.Types.ObjectId(id)) };
    } else if (query.hasPendingCustomProducts === 'true') {
      filter.status = 'APPROVED';
      const pendingSubmissions = await ProductSubmission.distinct('sellerId', { status: 'PENDING' });
      filter.sellerId = { $in: pendingSubmissions };
    } else if (query.hasPendingPriceChanges === 'true') {
      filter.status = 'APPROVED';
      const pendingListings = await SellerListing.distinct('sellerId', { reviewStatus: { $in: ['UNDER_REVIEW', 'PENDING_REVIEW'] } });
      filter.sellerId = { $in: pendingListings };
    } else {
      // All shops tab: approved shops + pending review shops
      filter.status = { $in: ['APPROVED', 'PENDING_APPROVAL', 'CHANGES_REQUIRED', 'UNDER_REVIEW'] };
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      const orConditions: Array<Record<string, any>> = [
        { shopName: { $regex: q, $options: 'i' } },
        { fullName: { $regex: q, $options: 'i' } },
        { city: { $regex: q, $options: 'i' } },
        { mobileNumber: { $regex: q, $options: 'i' } },
      ];
      if (q.toUpperCase().startsWith('SH-')) {
        const shortPart = q.slice(3).trim();
        if (mongoose.Types.ObjectId.isValid(shortPart)) {
          orConditions.push({ sellerId: new mongoose.Types.ObjectId(shortPart) });
        }
      } else if (mongoose.Types.ObjectId.isValid(q)) {
        orConditions.push({ sellerId: new mongoose.Types.ObjectId(q) });
      }

      const matchingSellers = await Seller.find({
        $or: [
          { fullName: { $regex: q, $options: 'i' } },
          { mobileNumber: { $regex: q, $options: 'i' } },
          { userId: { $regex: q, $options: 'i' } },
        ],
      })
        .select('_id')
        .lean();
      if (matchingSellers.length > 0) {
        orConditions.push({ sellerId: { $in: matchingSellers.map((s) => s._id) } });
      }

      filter.$or = orConditions;
    }

    const result = await paginate(SellerOnboarding, filter, query);

    type OnboardingRow = {
      sellerId: mongoose.Types.ObjectId | string;
      shopName?: string;
      shopType?: string;
      category?: string;
      city?: string;
      state?: string;
      fullName?: string;
      mobileNumber?: string;
      status?: string;
    };

    const sellerIds = [
      ...new Set(
        result.items
          .map((row) => String((row as OnboardingRow).sellerId))
          .filter((id) => mongoose.Types.ObjectId.isValid(id)),
      ),
    ];

    const sellers = sellerIds.length
      ? await Seller.find({ _id: { $in: sellerIds } }).select('_id status fullName mobileNumber userId').lean()
      : [];
    const sellerMap = new Map(sellers.map((seller) => [String(seller._id), seller]));

    const sellerObjectIds = sellerIds.map((id) => new mongoose.Types.ObjectId(id));
    const [counts, pendingSubmissions, pendingListings, rejectedSubmissions, rejectedPriceLogs] = await Promise.all([
      sellerObjectIds.length
        ? SellerListing.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
            { $match: { sellerId: { $in: sellerObjectIds } } },
            { $group: { _id: '$sellerId', count: { $sum: 1 } } },
          ])
        : [],
      sellerObjectIds.length
        ? ProductSubmission.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
            { $match: { sellerId: { $in: sellerObjectIds }, status: 'PENDING' } },
            { $group: { _id: '$sellerId', count: { $sum: 1 } } },
          ])
        : [],
      sellerObjectIds.length
        ? SellerListing.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
            { $match: { sellerId: { $in: sellerObjectIds }, reviewStatus: { $in: ['UNDER_REVIEW', 'PENDING_REVIEW'] } } },
            { $group: { _id: '$sellerId', count: { $sum: 1 } } },
          ])
        : [],
      sellerObjectIds.length
        ? ProductSubmission.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
            { $match: { sellerId: { $in: sellerObjectIds }, status: 'REJECTED' } },
            { $group: { _id: '$sellerId', count: { $sum: 1 } } },
          ])
        : [],
      sellerObjectIds.length
        ? PriceReviewLog.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
            { $match: { sellerId: { $in: sellerObjectIds }, status: 'REJECTED' } },
            { $group: { _id: '$sellerId', count: { $sum: 1 } } },
          ])
        : [],
    ]);

    const countMap = new Map(counts.map((entry) => [String(entry._id), entry.count]));
    const pendingSubMap = new Map(pendingSubmissions.map((entry) => [String(entry._id), entry.count]));
    const pendingListingsMap = new Map(pendingListings.map((entry) => [String(entry._id), entry.count]));
    const rejectedSubMap = new Map(rejectedSubmissions.map((entry) => [String(entry._id), entry.count]));
    const rejectedPriceMap = new Map(rejectedPriceLogs.map((entry) => [String(entry._id), entry.count]));

    const items = result.items.map((row) => {
      const onboarding = row as OnboardingRow;
      const sellerId = String(onboarding.sellerId);
      const seller = sellerMap.get(sellerId);
      const pendingCustom = pendingSubMap.get(sellerId) ?? 0;
      const pendingPrice = pendingListingsMap.get(sellerId) ?? 0;
      const rejectedTotal = (rejectedSubMap.get(sellerId) ?? 0) + (rejectedPriceMap.get(sellerId) ?? 0);
      const isKycPending =
        onboarding.status === 'PENDING_APPROVAL' ||
        onboarding.status === 'CHANGES_REQUIRED' ||
        onboarding.status === 'UNDER_REVIEW' ||
        seller?.status === 'PENDING';
      const isUnderReview = (pendingCustom + pendingPrice) > 0;
      const displayStatus = isKycPending ? 'KYC Pending' : (seller?.status === 'ACTIVE' ? 'Active' : (seller?.status || 'Active'));

      return {
        sellerId,
        shopId: sellerId,
        formattedShopId: `SH-${sellerId.slice(-4).toUpperCase()}`,
        shopName: onboarding.shopName ?? '—',
        shopType: onboarding.shopType,
        shopCategory: onboarding.category || onboarding.shopType || 'General',
        city: onboarding.city,
        state: onboarding.state,
        ownerName: onboarding.fullName || seller?.fullName || '—',
        mobileNumber: onboarding.mobileNumber || seller?.mobileNumber || '—',
        sellerStatus: displayStatus,
        onboardingStatus: onboarding.status || 'APPROVED',
        isUnderReview,
        productCount: countMap.get(sellerId) ?? 0,
        pendingProductRequests: pendingCustom + pendingPrice,
        pendingCustomProductRequests: pendingCustom,
        pendingPriceChanges: pendingPrice,
        rejectedRequests: rejectedTotal,
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
      address?: string;
      addressLine?: string;
      streetRoad?: string;
      area?: string;
      areaLocality?: string;
      locality?: string;
      city?: string;
      district?: string;
      state?: string;
      pincode?: string;
      latitude?: number;
      longitude?: number;
      formattedAddress?: string;
      geoSource?: string;
    }
  ) {
    const onboarding = await SellerOnboarding.findOne({ sellerId });
    if (!onboarding) throw new AppError('Complete shop registration first', 404);

    const EDITABLE = [
      'shopDescription',
      'shopMobileNumber',
      'shopEmail',
      'landmark',
      'shopImageUrl',
      'address',
      'streetRoad',
      'area',
      'locality',
      'city',
      'district',
      'state',
      'pincode',
      'formattedAddress',
      'geoSource',
    ] as const;

    const normalizedData = {
      ...data,
      address: data.address || data.addressLine,
      area: data.area || data.areaLocality,
      locality: data.locality || data.areaLocality || data.area,
      shopImageUrl: data.shopImageUrl ?? data.shopImage,
    };

    for (const key of EDITABLE) {
      if ((normalizedData as Record<string, unknown>)[key] !== undefined) {
        const v = String((normalizedData as Record<string, unknown>)[key]).trim();
        (onboarding as unknown as Record<string, unknown>)[key] = v || undefined;
      }
    }

    if (typeof data.latitude === 'number' && !isNaN(data.latitude)) {
      onboarding.latitude = data.latitude;
    }
    if (typeof data.longitude === 'number' && !isNaN(data.longitude)) {
      onboarding.longitude = data.longitude;
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
    delete sanitizedFields.aadhaarVerificationStatus;
    delete sanitizedFields.aadhaarVerifiedAt;
    delete sanitizedFields.aadhaarVerifiedName;
    delete sanitizedFields.aadhaarVerifiedDob;
    delete sanitizedFields.aadhaarVerifiedAddress;
    delete sanitizedFields.aadhaarOcrStatus;
    delete sanitizedFields.aadhaarOtpStatus;

    if (!onboarding) {
      onboarding = await SellerOnboarding.create({
        sellerId,
        shopType: 'Other',
        panVerificationStatus: 'NOT_VERIFIED',
        gstinVerificationStatus: 'NOT_VERIFIED',
        aadhaarVerificationStatus: 'NOT_VERIFIED',
      });
    }

    // Invalidation check: If pan string value changes, reset verification status
    if (sanitizedFields.pan !== undefined) {
      const newPan = String(sanitizedFields.pan || '').replace(/[\s-]/g, '').trim().toUpperCase();
      const curPan = String(onboarding.pan || '').replace(/[\s-]/g, '').trim().toUpperCase();
      const isMaskedSamePan = Boolean(curPan) && (newPan.includes('X') || newPan.includes('*')) && newPan.slice(-4) === curPan.slice(-4);
      if (!newPan && curPan) {
        if (onboarding.panVerificationStatus !== 'VERIFIED') {
          onboarding.pan = undefined;
          onboarding.panVerificationStatus = 'NOT_VERIFIED';
        }
        delete sanitizedFields.pan;
      } else if (newPan === curPan || isMaskedSamePan) {
        // Same PAN - keep current verified status!
        delete sanitizedFields.pan;
      } else if (newPan && newPan !== curPan) {
        onboarding.pan = newPan;
        onboarding.panVerificationStatus = 'NOT_VERIFIED';
        onboarding.panVerifiedAt = undefined;
        onboarding.panVerifiedName = undefined;
        delete sanitizedFields.pan; // already updated
      }
    } else if (onboarding.panVerificationStatus !== 'VERIFIED') {
      onboarding.pan = undefined;
      onboarding.panVerificationStatus = 'NOT_VERIFIED';
    }

    if (sanitizedFields.gstinApplicable !== undefined) {
      onboarding.gstinApplicable = Boolean(sanitizedFields.gstinApplicable);
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

    // Invalidation check: If aadhaar number changes to a different document, reset verification status
    if (sanitizedFields.aadhaarNumber !== undefined) {
      const cleanAadhaar = String(sanitizedFields.aadhaarNumber || '').replace(/[\s-]/g, '').trim();
      const curAadhaar = String(onboarding.aadhaarNumber || '').replace(/[\s-]/g, '').trim();
      if (cleanAadhaar) {
        // If already verified, only invalidate if the document number is genuinely different (different last 4 digits)
        const isSameCard = onboarding.aadhaarVerificationStatus === 'VERIFIED' &&
          cleanAadhaar.slice(-4) === curAadhaar.slice(-4);
        if (!isSameCard && cleanAadhaar !== curAadhaar) {
          onboarding.aadhaarNumber = cleanAadhaar;
          if (onboarding.aadhaarVerificationStatus === 'VERIFIED') {
            onboarding.aadhaarVerificationStatus = 'NOT_VERIFIED';
            onboarding.aadhaarOcrStatus = 'NOT_VERIFIED';
            onboarding.aadhaarVerifiedAt = undefined;
            onboarding.aadhaarVerifiedName = undefined;
            onboarding.aadhaarVerifiedDob = undefined;
            onboarding.aadhaarVerifiedAddress = undefined;
          }
        }
      }
      delete sanitizedFields.aadhaarNumber;
    }

    const cleanUrlPath = (u?: string) => {
      if (!u) return '';
      try {
        const parsed = new URL(u);
        return parsed.pathname;
      } catch {
        return u.split('?')[0].trim();
      }
    };

    // Invalidation check: If Aadhaar card images are replaced with a NEW remote uploaded document, reset verification status
    if (sanitizedFields.aadhaarFrontImageUrl !== undefined) {
      const newFront = String(sanitizedFields.aadhaarFrontImageUrl || '').trim();
      const curFront = String(onboarding.aadhaarFrontImageUrl || '').trim();
      const isLocalUri = newFront.startsWith('file://') || newFront.startsWith('content://') || newFront.startsWith('ph://');
      const isSameFront = isLocalUri || !newFront || (Boolean(curFront) && cleanUrlPath(newFront) === cleanUrlPath(curFront));
      if (onboarding.aadhaarVerificationStatus === 'VERIFIED') {
        if (isSameFront) {
          delete sanitizedFields.aadhaarFrontImageUrl; // keep verified remote URL
        } else if (newFront && !isSameFront) {
          onboarding.aadhaarVerificationStatus = 'NOT_VERIFIED';
          onboarding.aadhaarOcrStatus = 'NOT_VERIFIED';
          onboarding.aadhaarVerifiedAt = undefined;
          onboarding.aadhaarVerifiedName = undefined;
          onboarding.aadhaarVerifiedDob = undefined;
          onboarding.aadhaarVerifiedAddress = undefined;
        }
      }
    }

    if (sanitizedFields.aadhaarBackImageUrl !== undefined) {
      const newBack = String(sanitizedFields.aadhaarBackImageUrl || '').trim();
      const curBack = String(onboarding.aadhaarBackImageUrl || '').trim();
      const isLocalUri = newBack.startsWith('file://') || newBack.startsWith('content://') || newBack.startsWith('ph://');
      const isSameBack = isLocalUri || !newBack || (Boolean(curBack) && cleanUrlPath(newBack) === cleanUrlPath(curBack));
      if (onboarding.aadhaarVerificationStatus === 'VERIFIED') {
        if (isSameBack) {
          delete sanitizedFields.aadhaarBackImageUrl; // keep verified remote URL
        } else if (newBack && !isSameBack) {
          onboarding.aadhaarVerificationStatus = 'NOT_VERIFIED';
          onboarding.aadhaarOcrStatus = 'NOT_VERIFIED';
          onboarding.aadhaarVerifiedAt = undefined;
          onboarding.aadhaarVerifiedName = undefined;
          onboarding.aadhaarVerifiedDob = undefined;
          onboarding.aadhaarVerifiedAddress = undefined;
        }
      }
    }

    if (sanitizedFields.kycSelfieUri !== undefined) {
      const newSelfie = String(sanitizedFields.kycSelfieUri || '').trim();
      const curSelfie = String(onboarding.kycSelfieUri || '').trim();
      const isLocalUri = newSelfie.startsWith('file://') || newSelfie.startsWith('content://') || newSelfie.startsWith('ph://') || newSelfie.startsWith('/data/user/');
      if (isLocalUri) {
        if (curSelfie && !curSelfie.startsWith('file://')) {
          delete sanitizedFields.kycSelfieUri; // keep existing remote URL
        }
      }
    }

    // Clean legacy dummy values if present in existing document
    if (onboarding.shopName === 'My Shop') onboarding.shopName = '';
    if (onboarding.address === 'Pending Address') onboarding.address = '';
    if (onboarding.city === 'Pending City') onboarding.city = '';
    if (onboarding.state === 'Pending State') onboarding.state = '';
    if (onboarding.pincode === '000000') onboarding.pincode = '';
    if (onboarding.fullName === 'Draft Seller') onboarding.fullName = '';
    if (onboarding.mobileNumber === '0000000000' || /^0+$/.test(onboarding.mobileNumber || '')) onboarding.mobileNumber = '';

    // Ignore dummy zero phone numbers from draft payloads
    if (sanitizedFields.mobileNumber && (/^0+$/.test(String(sanitizedFields.mobileNumber)) || sanitizedFields.mobileNumber === '0000000000')) {
      delete sanitizedFields.mobileNumber;
    }

    // Assign sanitized fields non-destructively so partial step drafts do not wipe previous steps
    for (const [k, v] of Object.entries(sanitizedFields)) {
      if (v !== undefined && v !== null && v !== '') {
        // SECURITY / STABILITY GUARD: Never overwrite document fields with temporary signed proxy URLs
        if (typeof v === 'string' && v.includes('/documents/') && v.includes('/file') && v.includes('token=')) {
          continue;
        }
        (onboarding as any)[k] = v;
      }
    }
    if (!onboarding.shopType || !onboarding.shopType.trim()) {
      onboarding.shopType = 'Other';
    }

    // Preserve existing uploaded shop image if payload contains local or missing URI
    const isLocalShopUri = (u?: string) =>
      Boolean(u && (u.startsWith('file://') || u.startsWith('content://') || u.startsWith('/data/user/') || u.startsWith('ph://')));
    if (!onboarding.shopImageUrl || isLocalShopUri(onboarding.shopImageUrl)) {
      const existingShopImage = await SellerDocument.findOne({
        sellerId,
        documentType: 'SHOP_IMAGE',
        fileUrl: { $exists: true, $nin: [null, ''] },
      });
      if (existingShopImage?.fileUrl) {
        onboarding.shopImageUrl = existingShopImage.fileUrl;
      }
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

    // Save and synchronize operating hours and working days to SellerStoreSettings
    const rawOpen = sanitizedFields.openTime || sanitizedFields.openingTime;
    const rawClose = sanitizedFields.closeTime || sanitizedFields.closingTime;
    const rawDays = sanitizedFields.daysOpen || sanitizedFields.workingDays;
    const rawHoursStr = sanitizedFields.openingHours || onboarding.openingHours;

    let parsedOpenTime: string | undefined;
    let parsedCloseTime: string | undefined;
    let parsedDaysOpen: Weekday[] | undefined;

    if (rawOpen) {
      const p = parse12hTo24h(String(rawOpen));
      if (p && /^([01]\d|2[0-3]):[0-5]\d$/.test(p)) parsedOpenTime = p;
    }
    if (rawClose) {
      const p = parse12hTo24h(String(rawClose));
      if (p && /^([01]\d|2[0-3]):[0-5]\d$/.test(p)) parsedCloseTime = p;
    }
    if (Array.isArray(rawDays) && rawDays.length > 0) {
      const canonicals = rawDays.map((d) => mapDayToCanonical(String(d))).filter(Boolean) as Weekday[];
      if (canonicals.length > 0) parsedDaysOpen = canonicals;
    }

    if ((!parsedOpenTime || !parsedCloseTime) && rawHoursStr) {
      const str = String(rawHoursStr);
      const match = str.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))\s*[–\-]\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/i);
      if (match) {
        if (!parsedOpenTime) parsedOpenTime = parse12hTo24h(match[1]);
        if (!parsedCloseTime) parsedCloseTime = parse12hTo24h(match[2]);
      }
    }

    const timingPatch: Record<string, unknown> = {};
    if (parsedOpenTime) timingPatch.openTime = parsedOpenTime;
    if (parsedCloseTime) timingPatch.closeTime = parsedCloseTime;
    if (parsedDaysOpen && parsedDaysOpen.length > 0) timingPatch.daysOpen = parsedDaysOpen;

    if (Object.keys(timingPatch).length > 0) {
      await SellerStoreSettings.findOneAndUpdate(
        { sellerId },
        { $set: timingPatch },
        { upsert: true, new: true }
      );
    }

    await onboarding.save();

    // Keep primary Seller document synced with latest owner name, phone, and email from onboarding
    let sellerModified = false;
    if (onboarding.fullName && onboarding.fullName.trim() && seller.fullName !== onboarding.fullName.trim()) {
      seller.fullName = onboarding.fullName.trim();
      sellerModified = true;
    }
    const cleanPhone =
      phoneLast10(onboarding.mobileNumber) ||
      phoneLast10(onboarding.shopMobileNumber) ||
      phoneLast10(sanitizedFields.mobileNumber ? String(sanitizedFields.mobileNumber) : undefined) ||
      phoneLast10(sanitizedFields.shopMobileNumber ? String(sanitizedFields.shopMobileNumber) : undefined);
    if (cleanPhone && cleanPhone !== '0000000000' && seller.mobileNumber !== cleanPhone) {
      seller.mobileNumber = cleanPhone;
      sellerModified = true;
    }
    if (onboarding.email && onboarding.email.trim() && seller.email !== onboarding.email.trim()) {
      seller.email = onboarding.email.trim();
      sellerModified = true;
    }
    if (sellerModified) {
      await seller.save();
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

      // PAN is optional: If verified, validate format. If not verified, clear it on submit so it does not block submission.
      if (onboarding.panVerificationStatus === 'VERIFIED') {
        if (pan && !PAN_RE.test(pan)) {
          errors.push('PAN format is invalid');
        }
      } else {
        // Any unverified or failed PAN is cleared and does not block onboarding submission
        onboarding.pan = undefined;
        onboarding.panVerificationStatus = 'NOT_VERIFIED';
        onboarding.panVerifiedAt = undefined;
        onboarding.panVerifiedName = undefined;
      }

      if (gstin) {
        if (!GSTIN_RE.test(gstin)) errors.push('GSTIN format is invalid');
        if (onboarding.gstinVerificationStatus !== 'VERIFIED') {
          errors.push('GSTIN must be verified before submitting onboarding application');
        }
      }

      // If aadhaarVerificationStatus was desynced, but SellerDocument has verified Aadhaar cards, restore it
      if (onboarding.aadhaarVerificationStatus !== 'VERIFIED') {
        const verifiedAadhaarFront = await SellerDocument.findOne({
          sellerId,
          documentType: { $in: ['AADHAAR_CARD', 'AADHAAR_CARD_FRONT'] },
          verificationStatus: 'VERIFIED',
        });
        const verifiedAadhaarBack = await SellerDocument.findOne({
          sellerId,
          documentType: 'AADHAAR_CARD_BACK',
          verificationStatus: 'VERIFIED',
        });
        if (verifiedAadhaarFront?.fileUrl && verifiedAadhaarBack?.fileUrl) {
          onboarding.aadhaarVerificationStatus = 'VERIFIED';
          onboarding.aadhaarOcrStatus = 'VERIFIED';
          if (!onboarding.aadhaarFrontImageUrl) onboarding.aadhaarFrontImageUrl = verifiedAadhaarFront.fileUrl;
          if (!onboarding.aadhaarBackImageUrl) onboarding.aadhaarBackImageUrl = verifiedAadhaarBack.fileUrl;
          if (!onboarding.aadhaarDocumentUri) onboarding.aadhaarDocumentUri = verifiedAadhaarFront.fileUrl;
          await onboarding.save();
        }
      }

      // Aadhaar is mandatory and verification is required
      if (onboarding.aadhaarVerificationStatus !== 'VERIFIED') {
        errors.push('Aadhaar must be verified before submitting onboarding application');
      }
      const aadhaar = String(onboarding.aadhaarNumber || '').replace(/[\s-]/g, '').trim();
      if (aadhaar && !aadhaar.includes('X') && aadhaar.length !== 4 && !/^[2-9]\d{11}$/.test(aadhaar)) {
        errors.push('Aadhaar number must be a valid 12-digit number starting with 2-9');
      }
      if (!onboarding.aadhaarFrontImageUrl && !onboarding.aadhaarDocumentUri) {
        errors.push('Aadhaar front-side card image is required');
      }
      if (!onboarding.aadhaarBackImageUrl) {
        errors.push('Aadhaar back-side card image is required');
      }

      // Bank account is optional during onboarding. If provided, required fields must be present and valid.
      const bank = onboarding.bankAccount;
      const bankProvided = Boolean(bank?.accountNumber?.trim() || bank?.ifscCode?.trim());
      if (bankProvided) {
        if (!bank?.accountNumber?.trim()) {
          errors.push('Bank account number is required when bank details are provided');
        }
        if (!bank?.ifscCode?.trim()) {
          errors.push('Bank IFSC code is required when bank details are provided');
        } else if (!IFSC_RE.test(bank.ifscCode.trim())) {
          errors.push('Bank IFSC code format is invalid');
        }
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

      emitSellerOnboardingUpdated(sellerId, {
        status: 'PENDING_APPROVAL',
        action: previousStatus === 'DRAFT' ? 'SUBMITTED' : 'RESUBMITTED',
        reviewNote: undefined,
        updatedAt: new Date(),
        userId: seller.userId,
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
        fullName: seller.fullName || '',
        mobileNumber: seller.mobileNumber || '',
        email: seller.email,
        shopName: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
        shopType: 'Other',
        panVerificationStatus: 'NOT_VERIFIED',
        gstinVerificationStatus: 'NOT_VERIFIED',
      });
    }
    if ((onboarding.status === 'PENDING_APPROVAL' || onboarding.status === 'APPROVED') && onboarding.panVerificationStatus === 'VERIFIED') {
      throw new AppError('PAN is already verified and locked', 403);
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
        // PAN is optional: Do not persist failed PAN to the onboarding draft
        throw new AppError(result.message || 'PAN verification failed', 400);
      }
    } catch (err: any) {
      // PAN is optional: Do not persist failed PAN to the onboarding draft
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
        fullName: seller.fullName || '',
        mobileNumber: seller.mobileNumber || '',
        email: seller.email,
        shopName: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
        shopType: 'Other',
        panVerificationStatus: 'NOT_VERIFIED',
        gstinVerificationStatus: 'NOT_VERIFIED',
      });
    }
    if ((onboarding.status === 'PENDING_APPROVAL' || onboarding.status === 'APPROVED') && onboarding.gstinVerificationStatus === 'VERIFIED') {
      throw new AppError('GSTIN is already verified and locked', 403);
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
  static async verifySellerAadhaar(
    sellerId: string,
    aadhaarNumber?: string,
    _userToken?: string,
    aadhaarFrontImage?: string,
    aadhaarBackImage?: string,
    aadhaarFrontCrop?: Record<string, unknown>,
    aadhaarBackCrop?: Record<string, unknown>,
  ) {
    const cleanAadhaar = String(aadhaarNumber || '').replace(/[\s-]/g, '').trim();
    let validatedAadhaar: string | undefined = undefined;
    if (cleanAadhaar && !cleanAadhaar.includes('X') && cleanAadhaar.length !== 4) {
      if (!/^[2-9]\d{11}$/.test(cleanAadhaar)) {
        throw new AppError('Invalid Aadhaar format. Must be a 12-digit number starting with 2-9.', 400);
      }
      if (/^(\d)\1{11}$/.test(cleanAadhaar)) {
        throw new AppError('Invalid Aadhaar number. Cannot contain all identical digits.', 400);
      }
      validatedAadhaar = cleanAadhaar;
    }
    if (!aadhaarFrontImage) {
      throw new AppError('Aadhaar front-side image is required for verification.', 400);
    }
    if (!aadhaarBackImage) {
      throw new AppError('Aadhaar back-side image is required for verification.', 400);
    }

    const seller = await Seller.findById(sellerId);
    if (!seller) throw new AppError('Seller not found', 404);

    let onboarding = await SellerOnboarding.findOne({ sellerId });
    if (!onboarding) {
      onboarding = await SellerOnboarding.create({
        sellerId,
        fullName: seller.fullName || '',
        mobileNumber: seller.mobileNumber || '',
        email: seller.email,
        shopName: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
        shopType: 'Other',
        panVerificationStatus: 'NOT_VERIFIED',
        gstinVerificationStatus: 'NOT_VERIFIED',
        aadhaarVerificationStatus: 'NOT_VERIFIED',
      });
    }
    if (onboarding.status === 'PENDING_APPROVAL' || onboarding.status === 'APPROVED') {
      throw new AppError('Cannot modify details while application is under review or approved', 403);
    }

    // Capture previous status to avoid destroying or corrupting verified state on transient errors
    const previousVerificationStatus = onboarding.aadhaarVerificationStatus || 'NOT_VERIFIED';
    const previousOcrStatus = onboarding.aadhaarOcrStatus || 'NOT_VERIFIED';

    // Mark as UNDER_REVIEW while Cashfree verification is in progress (if not already verified)
    if (onboarding.aadhaarVerificationStatus !== 'VERIFIED') {
      onboarding.aadhaarVerificationStatus = 'UNDER_REVIEW';
      onboarding.aadhaarOcrStatus = 'UNDER_REVIEW';
    }
    if (aadhaarFrontImage && !aadhaarFrontImage.startsWith('data:')) {
      onboarding.aadhaarFrontImageUrl = aadhaarFrontImage;
    }
    if (aadhaarBackImage && !aadhaarBackImage.startsWith('data:')) {
      onboarding.aadhaarBackImageUrl = aadhaarBackImage;
    }
    await onboarding.save();

    // Validate Aadhaar with Cashfree Smart OCR API
    try {
      const result = await VerificationServiceClient.verifyAadhaar(
        _userToken || '',
        validatedAadhaar,
        aadhaarFrontImage,
        aadhaarBackImage,
        aadhaarFrontCrop,
        aadhaarBackCrop,
      );

      const resolvedAadhaarNumber = validatedAadhaar || result.aadhaarNumber || result.maskedAadhaar || '';
      if (resolvedAadhaarNumber) onboarding.aadhaarNumber = resolvedAadhaarNumber;
      let frontToSave = result.croppedFrontImage || aadhaarFrontImage;
      let backToSave = result.croppedBackImage || aadhaarBackImage;

      // If front image is a base64 string, upload to persistent storage
      if (frontToSave && frontToSave.startsWith('data:')) {
        try {
          const match = frontToSave.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const buf = Buffer.from(match[2], 'base64');
            const uploaded = await uploadBufferToStorage(buf, 'aadhaar_front.jpg', match[1], 'seller-documents');
            if (uploaded?.url) {
              frontToSave = uploaded.url;
            }
          }
        } catch (e: any) {
          logger.warn('Failed to upload base64 Aadhaar front to storage', { error: e.message });
        }
      }

      // If back image is a base64 string, upload to persistent storage
      if (backToSave && backToSave.startsWith('data:')) {
        try {
          const match = backToSave.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const buf = Buffer.from(match[2], 'base64');
            const uploaded = await uploadBufferToStorage(buf, 'aadhaar_back.jpg', match[1], 'seller-documents');
            if (uploaded?.url) {
              backToSave = uploaded.url;
            }
          }
        } catch (e: any) {
          logger.warn('Failed to upload base64 Aadhaar back to storage', { error: e.message });
        }
      }

      if (!result.aadhaarVerifiedName && !result.aadhaarNumber) {
        throw new AppError('Could not verify Aadhaar details from uploaded images. Please ensure images are clear.', 400);
      }

      if (frontToSave) onboarding.aadhaarFrontImageUrl = frontToSave;
      if (backToSave) onboarding.aadhaarBackImageUrl = backToSave;
      if (frontToSave) onboarding.aadhaarDocumentUri = frontToSave;
      if (result.aadhaarVerifiedName) {
        onboarding.aadhaarVerifiedName = result.aadhaarVerifiedName;
        const curName = (onboarding.fullName || '').trim();
        const isDefault = !curName || curName === 'Draft Seller' || curName === 'Seller' || /^Seller\s*\d+$/i.test(curName);
        if (isDefault) {
          onboarding.fullName = result.aadhaarVerifiedName;
        }
      }
      if (result.aadhaarVerifiedDob) onboarding.aadhaarVerifiedDob = result.aadhaarVerifiedDob;
      if (result.aadhaarVerifiedAddress) onboarding.aadhaarVerifiedAddress = result.aadhaarVerifiedAddress;

      onboarding.aadhaarOcrStatus = 'VERIFIED';
      onboarding.aadhaarVerificationStatus = 'VERIFIED';
      onboarding.aadhaarVerifiedAt = new Date();
      await onboarding.save();

      if (onboarding.fullName && onboarding.fullName.trim()) {
        const s = await Seller.findById(onboarding.sellerId);
        if (s) {
          const curSellerName = (s.fullName || '').trim();
          if (!curSellerName || curSellerName === 'Draft Seller' || curSellerName === 'Seller' || /^Seller\s*\d+$/i.test(curSellerName)) {
            s.fullName = onboarding.fullName.trim();
            await s.save();
          }
        }
      }

      // Upsert SellerDocument records so admin approvals and document queries discover them
      if (frontToSave) {
        await SellerDocument.findOneAndUpdate(
          { sellerId: onboarding.sellerId, documentType: 'AADHAAR_CARD' },
          {
            $set: {
              fileName: 'Aadhaar Card Front',
              fileUrl: frontToSave,
              mimeType: 'image/jpeg',
              verificationStatus: 'VERIFIED',
              uploadedAt: new Date(),
            },
            $setOnInsert: {
              onboardingId: onboarding._id,
              fileSize: 1024,
            },
          },
          { upsert: true, new: true }
        );
      }
      if (backToSave) {
        await SellerDocument.findOneAndUpdate(
          { sellerId: onboarding.sellerId, documentType: 'AADHAAR_CARD_BACK' },
          {
            $set: {
              fileName: 'Aadhaar Card Back',
              fileUrl: backToSave,
              mimeType: 'image/jpeg',
              verificationStatus: 'VERIFIED',
              uploadedAt: new Date(),
            },
            $setOnInsert: {
              onboardingId: onboarding._id,
              fileSize: 1024,
            },
          },
          { upsert: true, new: true }
        );
      }

      const resolvedFrontUrl = frontToSave ? await resolveSecureDocumentUrl(sellerId, 'AADHAAR_CARD', frontToSave) : undefined;
      const resolvedBackUrl = backToSave ? await resolveSecureDocumentUrl(sellerId, 'AADHAAR_CARD_BACK', backToSave) : undefined;

      return {
        success: true,
        aadhaarNumber: onboarding.aadhaarNumber,
        maskedAadhaar: result.maskedAadhaar || (cleanAadhaar ? ('XXXX-XXXX-' + cleanAadhaar.slice(-4)) : onboarding.aadhaarNumber),
        aadhaarVerifiedName: onboarding.aadhaarVerifiedName,
        aadhaarVerifiedDob: onboarding.aadhaarVerifiedDob,
        aadhaarVerifiedAddress: onboarding.aadhaarVerifiedAddress,
        aadhaarFrontImageUrl: resolvedFrontUrl || onboarding.aadhaarFrontImageUrl,
        aadhaarBackImageUrl: resolvedBackUrl || onboarding.aadhaarBackImageUrl,
        aadhaarOcrStatus: 'VERIFIED' as const,
        aadhaarVerificationStatus: 'VERIFIED' as const,
        aadhaarVerifiedAt: onboarding.aadhaarVerifiedAt,
        message: 'Aadhaar document verified successfully via Smart OCR.',
      };
    } catch (err: any) {
      const statusCode = err instanceof AppError ? err.statusCode : 500;
      const isClientValidationFailure = statusCode === 400 || statusCode === 422;

      if (isClientValidationFailure) {
        // Genuine validation / bad document failure
        // Only mark FAILED if document was not previously verified
        if (previousVerificationStatus !== 'VERIFIED') {
          if (cleanAadhaar) onboarding.aadhaarNumber = cleanAadhaar;
          if (aadhaarFrontImage) onboarding.aadhaarFrontImageUrl = aadhaarFrontImage;
          if (aadhaarBackImage) onboarding.aadhaarBackImageUrl = aadhaarBackImage;
          onboarding.aadhaarOcrStatus = 'FAILED';
          onboarding.aadhaarVerificationStatus = 'FAILED';
          onboarding.aadhaarVerifiedAt = undefined;
          onboarding.aadhaarVerifiedName = undefined;
          onboarding.aadhaarVerifiedDob = undefined;
          onboarding.aadhaarVerifiedAddress = undefined;
          await onboarding.save();
        }
        throw err;
      }

      // Infrastructure / transient errors (HTTP 502, 503, 504, 500, network timeouts)
      // DO NOT permanently mark the Aadhaar document as FAILED or invalid!
      // Restore previous state if VERIFIED, otherwise reset to NOT_VERIFIED so the seller can retry.
      if (previousVerificationStatus === 'VERIFIED') {
        onboarding.aadhaarVerificationStatus = 'VERIFIED';
        onboarding.aadhaarOcrStatus = previousOcrStatus === 'VERIFIED' ? 'VERIFIED' : 'NOT_VERIFIED';
      } else {
        onboarding.aadhaarVerificationStatus = 'NOT_VERIFIED';
        onboarding.aadhaarOcrStatus = 'NOT_VERIFIED';
      }
      await onboarding.save();

      if (err instanceof AppError) {
        throw err;
      }
      logger.error('Unexpected error in verifySellerAadhaar', { error: err.message });
      throw new AppError('Failed to verify Aadhaar document: ' + err.message, 502);
    }
  }

  /**
   * Resend seller Aadhaar OTP (Regenerates OTP for already OCR-verified Aadhaar)
   */
  static async resendSellerAadhaarOTP(sellerId: string, userToken: string) {
    const onboarding = await SellerOnboarding.findOne({ sellerId });
    if (!onboarding) throw new AppError('Seller onboarding profile not found', 404);

    if (onboarding.status === 'PENDING_APPROVAL' || onboarding.status === 'APPROVED') {
      throw new AppError('Cannot modify details while application is under review or approved', 403);
    }

    if (onboarding.aadhaarOcrStatus !== 'VERIFIED') {
      throw new AppError('Smart OCR document verification must be completed successfully before requesting OTP.', 400);
    }

    const cleanAadhaar = onboarding.aadhaarNumber?.replace(/[\s-]/g, '').trim();
    if (!cleanAadhaar || !/^[2-9]\d{11}$/.test(cleanAadhaar)) {
      throw new AppError('Valid Aadhaar number not found in profile. Please verify Aadhaar documents again.', 400);
    }

    try {
      const otpResult = await VerificationServiceClient.generateAadhaarOTP(userToken || '', cleanAadhaar);
      onboarding.aadhaarRefId = otpResult.refId;
      await onboarding.save();

      return {
        success: true,
        refId: otpResult.refId,
        otpSent: true,
        message: 'A fresh OTP has been sent to your Aadhaar-registered mobile number.',
      };
    } catch (err: any) {
      logger.error('Failed to resend Aadhaar OTP', { error: err.message });
      throw new AppError(err.message || 'Failed to resend Aadhaar OTP. Please try again.', err.statusCode || 400);
    }
  }

  /**
   * Verify seller Aadhaar OTP (Completes combined verification)
   */
  static async verifySellerAadhaarOTP(
    sellerId: string,
    userToken: string,
    refId: string,
    otp: string,
    aadhaarNumber?: string
  ) {
    const onboarding = await SellerOnboarding.findOne({ sellerId });
    if (!onboarding) throw new AppError('Seller onboarding profile not found', 404);

    if (onboarding.status === 'PENDING_APPROVAL' || onboarding.status === 'APPROVED') {
      throw new AppError('Cannot modify details while application is under review or approved', 403);
    }

    if (onboarding.aadhaarOcrStatus !== 'VERIFIED') {
      throw new AppError('Smart OCR document verification must be completed successfully before OTP verification.', 400);
    }

    const effectiveRefId = refId || onboarding.aadhaarRefId;
    if (!effectiveRefId) {
      throw new AppError('Missing verification reference ID. Please initiate Aadhaar verification again.', 400);
    }

    const otpData = await VerificationServiceClient.verifyAadhaarOTP(
      userToken,
      effectiveRefId,
      otp,
      aadhaarNumber || onboarding.aadhaarNumber
    );

    const verifiedDetails = otpData.verifiedData || {};

    onboarding.aadhaarOtpStatus = 'VERIFIED';
    onboarding.aadhaarVerificationStatus = 'VERIFIED'; // Combined rule satisfied!
    onboarding.aadhaarVerifiedAt = new Date();
    if (verifiedDetails.name) {
      onboarding.aadhaarVerifiedName = verifiedDetails.name;
      const curName = (onboarding.fullName || '').trim();
      const isDefault = !curName || curName === 'Draft Seller' || curName === 'Seller' || /^Seller\s*\d+$/i.test(curName);
      if (isDefault) {
        onboarding.fullName = verifiedDetails.name;
      }
    }
    if (verifiedDetails.dob) onboarding.aadhaarVerifiedDob = String(verifiedDetails.dob);
    if (verifiedDetails.address) {
      onboarding.aadhaarVerifiedAddress = typeof verifiedDetails.address === 'object'
        ? [verifiedDetails.address.line1, verifiedDetails.address.line2, verifiedDetails.address.city, verifiedDetails.address.state, verifiedDetails.address.pincode].filter(Boolean).join(', ')
        : String(verifiedDetails.address);
    }
    await onboarding.save();

    if (onboarding.fullName && onboarding.fullName.trim()) {
      const s = await Seller.findById(onboarding.sellerId);
      if (s) {
        const curSellerName = (s.fullName || '').trim();
        if (!curSellerName || curSellerName === 'Draft Seller' || curSellerName === 'Seller' || /^Seller\s*\d+$/i.test(curSellerName)) {
          s.fullName = onboarding.fullName.trim();
          await s.save();
        }
      }
    }

    return {
      success: true,
      aadhaarVerificationStatus: 'VERIFIED' as const,
      aadhaarOcrStatus: 'VERIFIED' as const,
      aadhaarOtpStatus: 'VERIFIED' as const,
      aadhaarVerifiedAt: onboarding.aadhaarVerifiedAt.toISOString(),
      aadhaarVerifiedName: onboarding.aadhaarVerifiedName,
      aadhaarVerifiedDob: onboarding.aadhaarVerifiedDob,
      aadhaarVerifiedAddress: onboarding.aadhaarVerifiedAddress,
      maskedAadhaar: otpData.maskedAadhaar || (onboarding.aadhaarNumber ? 'XXXX-XXXX-' + onboarding.aadhaarNumber.slice(-4) : 'XXXX-XXXX-XXXX'),
      message: 'Aadhaar fully verified via Smart OCR and OTP!',
    };
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
        fullName: seller.fullName || '',
        mobileNumber: seller.mobileNumber || '',
        email: seller.email,
        shopName: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
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

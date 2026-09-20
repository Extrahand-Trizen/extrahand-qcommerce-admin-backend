import CustomerOrder, { IQcOrderAddress, IQcOrderItem, ICustomerOrder } from '../models/CustomerOrder';
import CustomerCart from '../models/CustomerCart';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import Promotion from '../models/Promotion';
import PromotionRedemption from '../models/PromotionRedemption';
import SellerListing from '../models/SellerListing';
import SellerStoreSettings from '../models/SellerStoreSettings';
import { Types } from 'mongoose';
import { StorefrontService, StorefrontQuery } from './StorefrontService';
import {
  notifyCustomerOrderCancelled,
  notifySellerNewOrder,
  notifySellerOrderCancelled,
} from './QcOrderNotificationService';
import { reopenExpiredPauses, rolloverRejectionDayIfNeeded } from './SellerFulfillmentHealthService';
import { AppError } from '../utils/response';
import { discountForAmount, computePromotionDiscount } from '../utils/promotionMath';
import { promotionStatus } from './PromotionService';
import { env } from '../config/env';
import { ACCEPT_WINDOW_SECONDS } from '../config/orderFulfillment';
import {
  QcDeliveryOptionsService,
  type QcDeliveryType,
} from './QcDeliveryOptionsService';
import { OrderTimeoutService } from './OrderTimeoutService';
import { issueOrderRefund } from './PaymentService';
import { InventoryService } from './InventoryService';
import { notifyAvailableQcOrder, triggerQcAutoAssign } from './TaskServiceClient';
import { resolvePublicAssetUrl } from '../utils/media';
import {
  fetchPartnerProfile,
  getUserProfilesByIds,
  PartnerProfileLite,
  UserProfileSummary,
} from './UserServiceClient';
import { OrderPickupService } from './OrderPickupService';
import OrderPickupQR from '../models/OrderPickupQR';
import { emitNewOrder, emitOrderUpdated } from '../socket/orderSocket';
import { SellerLedgerService } from './SellerLedgerService';
import logger from '../config/logger';

const MIN_ORDER_PAISE = 100;
const FREE_DELIVERY_THRESHOLD_PAISE = 19900;
const DELIVERY_FEE_PAISE = 2900;
const HANDLING_FEE_PAISE = 0;
/** After handover, auto-complete delivery for history filters if rider app isn't wired yet. */
const AUTO_DELIVER_AFTER_HANDOVER_MS = 90 * 60 * 1000;

function buildInvoiceNumber(orderNumber: string, at: Date, orderId: string): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  const d = String(at.getUTCDate()).padStart(2, '0');
  const tail = String(orderId)
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-6)
    .toUpperCase()
    .padStart(6, '0');
  void orderNumber;
  return `INV-EXQ-${y}${m}${d}-${tail}`;
}

function ensureInvoiceOnOrder(order: {
  paymentStatus?: string;
  invoiceNumber?: string;
  invoiceGeneratedAt?: Date;
  orderNumber: string;
  createdAt?: Date;
  _id: { toString(): string };
}): boolean {
  if (String(order.paymentStatus || '').toUpperCase() !== 'PAID') return false;
  if (order.invoiceNumber?.trim()) return false;
  const at = order.createdAt ? new Date(order.createdAt) : new Date();
  order.invoiceNumber = buildInvoiceNumber(order.orderNumber, at, order._id.toString());
  order.invoiceGeneratedAt = new Date();
  return true;
}

function classifyOrderBucket(order: {
  status?: string;
  fulfillmentStatus?: string;
  paymentStatus?: string;
}): 'active' | 'completed' | 'cancelled' {
  const status = String(order.status || '').toUpperCase();
  const fulfillment = String(order.fulfillmentStatus || '').toUpperCase();
  const payment = String(order.paymentStatus || '').toUpperCase();
  // Unpaid checkouts are not real orders — listOrders excludes them entirely.
  if (payment !== 'PAID' || status === 'PENDING_PAYMENT') {
    return 'cancelled';
  }
  if (
    status === 'CANCELLED' ||
    status === 'FAILED' ||
    fulfillment === 'REJECTED' ||
    fulfillment === 'CANCELLED'
  ) {
    return 'cancelled';
  }
  if (status === 'DELIVERED') return 'completed';
  if (['PAID', 'CONFIRMED', 'ASSIGNED'].includes(status)) return 'active';
  return 'active';
}

export type CheckoutInput = {
  address: IQcOrderAddress & {
    latitude?: number;
    longitude?: number;
    receiverName?: string;
    receiverPhone?: string;
  };
  deliveryInstructions?: string[];
  partnerTipPaise?: number;
  /** New trusted path — the server recomputes the discount from this code. */
  couponCode?: string;
  /** Legacy path (pre-code-redemption customer app) — trusted as-is. */
  couponDiscountPaise?: number;
  /** EXPRESS (default) or SCHEDULED. */
  deliveryType?: QcDeliveryType | string;
  /** Required when deliveryType is SCHEDULED — QcDeliverySlot id. */
  scheduledSlotId?: string;
};

function normalizeCheckoutAddress(
  raw: CheckoutInput['address'],
): IQcOrderAddress {
  const lat = Number(raw.latitude);
  const lng = Number(raw.longitude);
  let coordinates = raw.coordinates;
  if (
    (!Array.isArray(coordinates) || coordinates.length < 2) &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    coordinates = [lng, lat];
  } else if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const a = Number(coordinates[0]);
    const b = Number(coordinates[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      coordinates = [a, b];
    } else {
      coordinates = undefined;
    }
  } else {
    coordinates = undefined;
  }

  return {
    label: raw.label,
    line1: raw.line1,
    line2: raw.line2,
    city: raw.city,
    state: raw.state,
    pinCode: raw.pinCode,
    coordinates,
    name: raw.name || raw.receiverName,
    phone: raw.phone || raw.receiverPhone,
  };
}

type CouponReason = 'NOT_FOUND' | 'INACTIVE' | 'MIN_ORDER' | 'LIMIT' | 'NOT_APPLICABLE' | 'CART';

class CouponError extends Error {
  constructor(public reason: CouponReason, message: string) {
    super(message);
    this.name = 'CouponError';
  }
}

function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `QC-${ts}-${rand}`;
}

/**
 * @deprecated Pickup handover is now Order-Pickup-QR-driven (OrderPickupService).
 * Retained only for the ad-hoc seed scripts under src/scripts that still stamp a
 * `handoverCode` on fixture orders. Not used in any live flow.
 */
export function generateHandoverCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

type CheckoutAutoOffer = {
  promotionId: Types.ObjectId;
  type: 'PERCENT' | 'FLAT';
  value: number;
  maxDiscountPaise?: number;
};

/** Active AUTOMATIC offers for a seller, keyed by masterProductId string. */
async function loadAutoOffersForSeller(
  sellerId: Types.ObjectId | string | { toString(): string },
  masterProductIds: Array<Types.ObjectId | string>,
): Promise<Map<string, CheckoutAutoOffer>> {
  const ids = masterProductIds.map((id) => new Types.ObjectId(String(id)));
  if (!ids.length) return new Map();

  const now = new Date();
  const promos = await Promotion.find({
    sellerId: new Types.ObjectId(String(sellerId)),
    trigger: 'AUTOMATIC',
    state: 'ACTIVE',
    startsAt: { $lte: now },
    endsAt: { $gte: now },
    productMasterIds: { $in: ids },
  })
    .select('type value maxDiscountPaise productMasterIds')
    .lean();

  const map = new Map<string, CheckoutAutoOffer>();
  for (const promo of promos) {
    for (const pid of promo.productMasterIds ?? []) {
      const key = pid.toString();
      if (!map.has(key)) {
        map.set(key, {
          promotionId: promo._id as Types.ObjectId,
          type: promo.type,
          value: promo.value,
          maxDiscountPaise: promo.maxDiscountPaise,
        });
      }
    }
  }
  return map;
}

/** The seller's own list (selling) price per masterProductId, in paise. */
async function loadSellerListPrices(
  sellerId: Types.ObjectId | string | { toString(): string },
  masterProductIds: Array<Types.ObjectId | string>,
): Promise<Map<string, number>> {
  const ids = masterProductIds.map((id) => new Types.ObjectId(String(id)));
  if (!ids.length) return new Map();
  const listings = await SellerListing.find({
    sellerId: new Types.ObjectId(String(sellerId)),
    masterProductId: { $in: ids },
  })
    .select('masterProductId sellingPricePaise')
    .lean();
  return new Map(listings.map((l) => [l.masterProductId.toString(), l.sellingPricePaise]));
}

/**
 * Write the promotion-redemption ledger + bump promotion totals for a paid
 * order. Idempotent via the unique { promotionId, orderId } index — a retried
 * confirmPayment silently no-ops.
 */
async function recordPromotionRedemptions(order: {
  _id: Types.ObjectId | { toString(): string };
  orderNumber: string;
  userId: string;
  sellerId?: Types.ObjectId | { toString(): string };
  items: IQcOrderItem[];
  couponCode?: string;
  couponDiscountPaise?: number;
}): Promise<void> {
  if (!order.sellerId) return;

  // --- discount-code redemption -----------------------------------------
  if (order.couponCode && (order.couponDiscountPaise ?? 0) > 0) {
    const promo = await Promotion.findOne({
      sellerId: new Types.ObjectId(String(order.sellerId)),
      code: order.couponCode,
      trigger: 'CODE',
    }).lean();
    if (promo) {
      const applied = computePromotionDiscount(
        {
          type: promo.type,
          value: promo.value,
          appliesTo: promo.appliesTo,
          productMasterIds: promo.productMasterIds ?? [],
          maxDiscountPaise: promo.maxDiscountPaise,
        },
        order.items.map((i) => ({
          masterProductId: i.masterProductId.toString(),
          name: i.name,
          quantity: i.quantity,
          lineTotalPaise: i.lineTotalPaise,
        })),
      );
      try {
        await PromotionRedemption.create({
          promotionId: promo._id,
          sellerId: new Types.ObjectId(String(order.sellerId)),
          code: order.couponCode,
          trigger: 'CODE',
          userId: order.userId,
          orderId: new Types.ObjectId(String(order._id)),
          orderNumber: order.orderNumber,
          discountPaise: order.couponDiscountPaise ?? 0,
          lines: applied.lines
            .filter((l) => l.discountPaise > 0)
            .map((l) => ({
              masterProductId: new Types.ObjectId(l.masterProductId),
              name: l.name,
              quantity: l.quantity,
              discountPaise: l.discountPaise,
            })),
        });
        await Promotion.updateOne(
          { _id: promo._id },
          { $inc: { usedCount: 1, totalDiscountGivenPaise: order.couponDiscountPaise ?? 0 } },
        );
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
      }
    }
  }

  const byPromo = new Map<
    string,
    { promotionId: Types.ObjectId; discountPaise: number; qty: number; lines: Array<{ masterProductId: Types.ObjectId; name: string; quantity: number; discountPaise: number }> }
  >();

  for (const item of order.items) {
    if (!item.offerPromotionId || !item.savingsPaise) continue;
    const key = item.offerPromotionId.toString();
    const bucket =
      byPromo.get(key) ??
      { promotionId: item.offerPromotionId as Types.ObjectId, discountPaise: 0, qty: 0, lines: [] };
    bucket.discountPaise += item.savingsPaise;
    bucket.qty += item.quantity;
    bucket.lines.push({
      masterProductId: item.masterProductId as Types.ObjectId,
      name: item.name,
      quantity: item.quantity,
      discountPaise: item.savingsPaise,
    });
    byPromo.set(key, bucket);
  }

  for (const bucket of byPromo.values()) {
    try {
      await PromotionRedemption.create({
        promotionId: bucket.promotionId,
        sellerId: new Types.ObjectId(String(order.sellerId)),
        trigger: 'AUTOMATIC',
        userId: order.userId,
        orderId: new Types.ObjectId(String(order._id)),
        orderNumber: order.orderNumber,
        discountPaise: bucket.discountPaise,
        lines: bucket.lines,
      });
    } catch (e) {
      // Duplicate key = already recorded on a previous confirmPayment; skip the bump.
      if ((e as { code?: number }).code === 11000) continue;
      throw e;
    }
    await Promotion.updateOne(
      { _id: bucket.promotionId },
      { $inc: { usedCount: bucket.qty, totalDiscountGivenPaise: bucket.discountPaise } },
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Cart -> priced order lines (shared by checkout + coupon validate)  */
/* ------------------------------------------------------------------ */

type OrderLine = {
  productSlug: string;
  masterProductId: Types.ObjectId;
  name: string;
  unit: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  imageUrl?: string;
  mrpPaise?: number;
  savingsPaise?: number;
  offerPromotionId?: Types.ObjectId;
};

type OrderContext = {
  sellerSnapshot: NonNullable<Awaited<ReturnType<typeof StorefrontService.resolveSellerStoreSnapshot>>>;
  orderItems: OrderLine[];
  itemTotalPaise: number;
};

async function buildOrderContext(userId: string, query: StorefrontQuery): Promise<OrderContext> {
  const cart = await CustomerCart.findOne({ userId }).lean();
  if (!cart?.items?.length) throw new AppError('Your cart is empty', 400);

  const sellerSnapshot = await StorefrontService.resolveSellerStoreSnapshot(query);
  if (!sellerSnapshot) throw new AppError('Storefront seller is not available', 503);

  const slugs = cart.items.map((item) => item.productSlug);
  const productMap = await StorefrontService.resolveProductsBySlugs(slugs, query);

  // Auto offers + the seller's own list prices, so discounted line prices are
  // recomputed server-side (base = the listing selling price).
  const cartMasterIds = cart.items.map((item) => item.masterProductId);
  const [autoOffers, listPriceByProduct] = await Promise.all([
    loadAutoOffersForSeller(sellerSnapshot.sellerId, cartMasterIds),
    loadSellerListPrices(sellerSnapshot.sellerId, cartMasterIds),
  ]);

  const orderItems: OrderLine[] = [];
  for (const line of cart.items) {
    const product = productMap.get(line.productSlug);
    const available = product?.availableQuantity ?? 0;

    if (!product?.purchasable || !product?.inStock || available <= 0) {
      throw new AppError(`${line.productSlug} is no longer available in this store. Please update your cart.`, 409);
    }

    if (line.quantity > available) {
      throw new AppError(
        `Cannot order ${line.quantity} of "${product.name}". Only ${available} available in this shop. Please update your cart.`,
        409,
      );
    }

    let unitPricePaise = Math.round(product.price * 100);
    let mrpPaise: number | undefined;
    let savingsPaise: number | undefined;
    let offerPromotionId: Types.ObjectId | undefined;

    const offer = autoOffers.get(line.masterProductId.toString());
    const listPricePaise = listPriceByProduct.get(line.masterProductId.toString());
    if (offer && listPricePaise != null) {
      const perUnitDiscount = discountForAmount(offer, listPricePaise);
      if (perUnitDiscount > 0) {
        unitPricePaise = listPricePaise - perUnitDiscount;
        mrpPaise = listPricePaise;
        savingsPaise = perUnitDiscount * line.quantity;
        offerPromotionId = offer.promotionId;
      }
    }

    orderItems.push({
      productSlug: line.productSlug,
      masterProductId: line.masterProductId,
      name: product.name,
      unit: product.unit,
      quantity: line.quantity,
      unitPricePaise,
      lineTotalPaise: unitPricePaise * line.quantity,
      imageUrl: product.imageUrl,
      mrpPaise,
      savingsPaise,
      offerPromotionId,
    });
  }

  const itemTotalPaise = orderItems.reduce((sum, item) => sum + item.lineTotalPaise, 0);
  if (itemTotalPaise < MIN_ORDER_PAISE) throw new AppError('Minimum order value is ₹1', 400);

  return { sellerSnapshot, orderItems, itemTotalPaise };
}

type ResolvedCoupon = {
  promotionId: Types.ObjectId;
  code: string;
  appliesTo: 'order' | 'products';
  discountPaise: number;
  lines: Array<{ masterProductId: string; name: string; quantity: number; discountPaise: number }>;
};

/**
 * Resolve a discount code for this shop only.
 * Codes come from the shopkeeper app (seller Promotions with trigger CODE) —
 * platform / coupon-portal codes are not accepted on QC checkout.
 */
async function resolveCoupon(
  sellerId: string,
  rawCode: string,
  userId: string,
  orderItems: OrderLine[],
  itemTotalPaise: number,
): Promise<ResolvedCoupon> {
  const code = String(rawCode).trim().toUpperCase();
  const promo = await Promotion.findOne({
    sellerId: new Types.ObjectId(sellerId),
    code,
    trigger: 'CODE',
  }).lean();
  if (!promo) {
    throw new CouponError('NOT_FOUND', `"${code}" is not a valid code for this shop`);
  }

  const status = promotionStatus(promo);
  if (status !== 'active') {
    const msg =
      status === 'scheduled' ? 'This code is not active yet'
        : status === 'expired' ? 'This code has expired'
          : status === 'paused' ? 'This code is currently paused'
            : 'This code has reached its usage limit';
    throw new CouponError('INACTIVE', msg);
  }

  if (promo.minOrderPaise && itemTotalPaise < promo.minOrderPaise) {
    throw new CouponError(
      'MIN_ORDER',
      `Add ₹${Math.ceil((promo.minOrderPaise - itemTotalPaise) / 100)} more to use this code`,
    );
  }

  if (promo.perCustomerLimit) {
    const used = await PromotionRedemption.countDocuments({ promotionId: promo._id, userId });
    if (used >= promo.perCustomerLimit) {
      throw new CouponError('LIMIT', "You've already used this code the maximum number of times");
    }
  }

  const applied = computePromotionDiscount(
    {
      type: promo.type,
      value: promo.value,
      appliesTo: promo.appliesTo,
      productMasterIds: promo.productMasterIds ?? [],
      maxDiscountPaise: promo.maxDiscountPaise,
    },
    orderItems.map((i) => ({
      masterProductId: i.masterProductId.toString(),
      name: i.name,
      quantity: i.quantity,
      lineTotalPaise: i.lineTotalPaise,
    })),
  );

  if (applied.discountPaise <= 0) {
    throw new CouponError(
      'NOT_APPLICABLE',
      promo.appliesTo === 'PRODUCTS'
        ? 'This code is for products that are not in your cart'
        : "This code can't be applied to your cart",
    );
  }

  return {
    promotionId: promo._id as Types.ObjectId,
    code,
    appliesTo: promo.appliesTo === 'PRODUCTS' ? 'products' : 'order',
    discountPaise: applied.discountPaise,
    lines: applied.lines.filter((l) => l.discountPaise > 0),
  };
}

type OrderStoreFields = {
  sellerId?: Types.ObjectId | string | { toString(): string };
  shopName?: string;
  shopCity?: string;
  shopAddress?: string;
  shopImage?: string;
  shopImageUrl?: string;
  shopLocation?: { latitude: number; longitude: number };
};

function formatShopAddress(onboarding: {
  address?: string;
  area?: string;
  locality?: string;
  city?: string;
  state?: string;
  pincode?: string;
}): string {
  return [
    onboarding.address,
    onboarding.area,
    onboarding.locality,
    onboarding.city,
    onboarding.state,
    onboarding.pincode,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(', ');
}

async function enrichOrdersWithStoreInfo<T extends OrderStoreFields>(orders: T[]): Promise<T[]> {
  if (!orders.length) return orders;

  const sellerIds = [
    ...new Set(
      orders
        .map((order) => order.sellerId?.toString())
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const onboardingBySellerId = new Map<
    string,
    {
      shopName?: string;
      city?: string;
      shopAddress?: string;
      shopImageUrl?: string;
      shopLocation?: { latitude: number; longitude: number };
    }
  >();
  if (sellerIds.length) {
    const rows = await SellerOnboarding.find({
      sellerId: { $in: sellerIds.map((id) => new Types.ObjectId(id)) },
    })
      .select(
        'sellerId shopName city address area locality state pincode shopImageUrl latitude longitude',
      )
      .lean();

    for (const row of rows) {
      onboardingBySellerId.set(row.sellerId.toString(), {
        shopName: row.shopName?.trim() || undefined,
        city: row.city?.trim() || undefined,
        shopAddress: formatShopAddress(row) || undefined,
        shopImageUrl: row.shopImageUrl ? resolvePublicAssetUrl(row.shopImageUrl) : undefined,
        shopLocation:
          Number.isFinite(Number(row.latitude)) &&
            Number.isFinite(Number(row.longitude))
            ? {
              latitude: Number(row.latitude),
              longitude: Number(row.longitude),
            }
            : undefined,
      });
    }
  }

  const needsFallback = orders.some((order) => !String(order.shopName || '').trim());
  const defaultSnapshot = needsFallback
    ? await StorefrontService.resolveSellerStoreSnapshot({})
    : null;

  return orders.map((order) => {
    const sellerKey = order.sellerId?.toString() || defaultSnapshot?.sellerId.toString();
    const onboarding = sellerKey ? onboardingBySellerId.get(sellerKey) : undefined;
    const shopName =
      String(order.shopName || '').trim() ||
      onboarding?.shopName ||
      (sellerKey === defaultSnapshot?.sellerId.toString() ? defaultSnapshot?.shopName : undefined) ||
      undefined;
    const shopCity =
      String(order.shopCity || '').trim() ||
      onboarding?.city ||
      (sellerKey === defaultSnapshot?.sellerId.toString() ? defaultSnapshot?.shopCity : undefined) ||
      undefined;
    const shopImageUrl =
      (order.shopImageUrl || order.shopImage ? resolvePublicAssetUrl(order.shopImageUrl || order.shopImage) : undefined) ||
      onboarding?.shopImageUrl ||
      (sellerKey === defaultSnapshot?.sellerId.toString() ? defaultSnapshot?.shopImageUrl : undefined) ||
      undefined;
    const shopAddress =
      String(order.shopAddress || '').trim() ||
      onboarding?.shopAddress ||
      shopCity ||
      undefined;

    return {
      ...order,
      sellerId: order.sellerId || defaultSnapshot?.sellerId,
      shopName,
      shopCity,
      shopAddress,
      shopImage: shopImageUrl,
      shopImageUrl,
      shopLocation: order.shopLocation || onboarding?.shopLocation,
    };
  });
}

type OrderAssignmentFields = {
  assignedTo?: {
    userId?: string;
    profileId?: string;
    name?: string;
    phone?: string;
    role?: string;
    assignedAt?: Date;
  };
  assigneeId?: Types.ObjectId | string | null;
  assigneeUid?: string | null;
  assignedHelperName?: string | null;
  assignedToName?: string | null;
  assigneeName?: string | null;
  assignedAt?: Date;
  assignmentStatus?: string;
  partnerId?: Types.ObjectId | string | null;
  partnerUid?: string | null;
  partnerAcceptedAt?: Date;
  executionPhase?: string;
  assignedPartner?: {
    id?: string;
    uid?: string;
    name: string;
    phone?: string;
    photoUrl?: string;
    rating?: number;
    totalReviews?: number;
    verified?: boolean;
    assignedAt?: Date;
    location?: {
      latitude: number;
      longitude: number;
    };
  };
};

async function enrichOrdersWithAssignedPartner<T extends OrderAssignmentFields>(
  orders: T[],
): Promise<T[]> {
  const profileIds = orders
    .map(
      (order) =>
        order.assignedTo?.profileId ||
        order.assigneeId?.toString() ||
        order.partnerId?.toString(),
    )
    .filter((id): id is string => Boolean(id));
  const profiles = await getUserProfilesByIds(profileIds);

  return orders.map((order) => {
    const profileId =
      order.assignedTo?.profileId ||
      order.assigneeId?.toString() ||
      order.partnerId?.toString();
    const profile: UserProfileSummary | undefined = profileId
      ? profiles.get(profileId)
      : undefined;
    const profileCoordinates = profile?.location?.coordinates;
    const partnerLocation =
      Array.isArray(profileCoordinates) &&
        profileCoordinates.length >= 2 &&
        Number.isFinite(Number(profileCoordinates[0])) &&
        Number.isFinite(Number(profileCoordinates[1]))
        ? {
          longitude: Number(profileCoordinates[0]),
          latitude: Number(profileCoordinates[1]),
        }
        : undefined;
    const hasAssignment =
      order.assignmentStatus === 'assigned' ||
      Boolean(profileId || order.assignedTo?.userId || order.assigneeUid || order.partnerUid);
    if (!hasAssignment) return order;

    return {
      ...order,
      assignedPartner: {
        id: profileId,
        uid:
          profile?.uid ||
          order.assignedTo?.userId ||
          order.assigneeUid ||
          order.partnerUid ||
          undefined,
        name:
          profile?.name?.trim() ||
          order.assignedTo?.name?.trim() ||
          order.assignedHelperName?.trim() ||
          order.assignedToName?.trim() ||
          order.assigneeName?.trim() ||
          'Delivery partner',
        phone: profile?.phone || order.assignedTo?.phone || undefined,
        photoUrl: profile?.photoURL || undefined,
        rating: profile?.rating,
        totalReviews: profile?.totalReviews,
        verified: Boolean(profile?.isVerified || profile?.isAadhaarVerified),
        assignedAt: order.assignedAt || order.assignedTo?.assignedAt,
        location: partnerLocation,
      },
    };
  });
}

type OrderWithItems = {
  items: Array<{ productSlug: string; imageUrl?: string }>;
};

async function enrichOrdersWithItemImages<T extends OrderWithItems>(orders: T[]): Promise<T[]> {
  if (!orders.length) return orders;

  const slugsNeedingImages = new Set<string>();
  for (const order of orders) {
    for (const item of order.items) {
      if (!String(item.imageUrl || '').trim() && item.productSlug) {
        slugsNeedingImages.add(item.productSlug);
      }
    }
  }

  if (!slugsNeedingImages.size) return orders;

  const productMap = await StorefrontService.resolveProductsBySlugs([...slugsNeedingImages]);

  return orders.map((order) => ({
    ...order,
    items: order.items.map((item) => ({
      ...item,
      imageUrl:
        String(item.imageUrl || '').trim() || productMap.get(item.productSlug)?.imageUrl || '',
    })),
  }));
}

export function formatOrder(order: {
  _id: { toString(): string };
  orderNumber: string;
  status: string;
  paymentStatus: string;
  sellerId?: { toString(): string };
  shopName?: string;
  shopCity?: string;
  shopAddress?: string;
  shopImage?: string;
  shopImageUrl?: string;
  shopLocation?: { latitude: number; longitude: number };
  items: Array<{
    productSlug: string;
    name: string;
    unit: string;
    quantity: number;
    unitPricePaise: number;
    lineTotalPaise: number;
    imageUrl?: string;
    mrpPaise?: number;
    savingsPaise?: number;
    preparationChecked?: boolean;
  }>;
  address: IQcOrderAddress;
  deliveryInstructions: string[];
  partnerTipPaise: number;
  itemTotalPaise: number;
  deliveryFeePaise: number;
  handlingFeePaise: number;
  couponCode?: string;
  couponDiscountPaise: number;
  amountPaise: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  invoiceNumber?: string;
  invoiceGeneratedAt?: Date;
  createdAt: Date;
  fulfillmentStatus?: string;
  acceptDeadline?: Date;
  acceptedAt?: Date;
  preparingStartedAt?: Date;
  prepMinutes?: number;
  prepMinutesAdded?: number;
  readyBy?: Date;
  readyAt?: Date;
  prepBreached?: boolean;
  rejectedReason?: string;
  rejectedNote?: string;
  assignmentStatus?: string;
  executionPhase?: string;
  assignedAt?: Date;
  assignedPartner?: OrderAssignmentFields['assignedPartner'];
  handoverCode?: string;
  partnerUid?: string | null;
  partnerName?: string | null;
  partnerPhone?: string | null;
  partnerAcceptedAt?: Date;
  completedAt?: Date;
  fulfillmentEvents?: Array<{ action: string; by: string; at: Date; meta?: unknown }>;
  refunds?: Array<{ amountPaise: number; reason: string; status: string; razorpayRefundId?: string; at: Date; note?: string }>;
  customerReview?: {
    deliveryPartnerRating: number;
    deliveryPartnerUid?: string | null;
    deliveryPartnerName?: string | null;
    itemRatings: Array<{ productSlug: string; name: string; rating: number; description?: string }>;
    submittedAt: Date;
  };
  deliveryType?: string;
  scheduledSlotId?: { toString(): string } | string;
  scheduledDate?: Date;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
}, opts: { forSeller?: boolean; forPartner?: boolean } = {}) {
  return {
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryType: order.deliveryType === 'SCHEDULED' ? 'SCHEDULED' : 'EXPRESS',
    scheduledSlotId: order.scheduledSlotId
      ? String(order.scheduledSlotId)
      : undefined,
    scheduledDate: order.scheduledDate,
    scheduledTimeStart: order.scheduledTimeStart,
    scheduledTimeEnd: order.scheduledTimeEnd,
    sellerId: order.sellerId?.toString(),
    shopName: String(order.shopName || '').trim() || 'Grocery store',
    shopCity: order.shopCity,
    shopAddress: String(order.shopAddress || '').trim() || order.shopCity || undefined,
    shopLocation: order.shopLocation,
    // Shop storefront image is only visible to seller and delivery partner apps, not to customer
    ...((opts.forSeller || opts.forPartner)
      ? {
        shopImage: order.shopImage || order.shopImageUrl,
        shopImageUrl: order.shopImageUrl || order.shopImage,
      }
      : {}),
    // Seller-driven fulfilment lifecycle (see CustomerOrder.QC_FULFILLMENT_STATUS).
    fulfillmentStatus: order.fulfillmentStatus,
    acceptDeadline: order.acceptDeadline,
    acceptedAt: order.acceptedAt,
    preparingStartedAt: order.preparingStartedAt,
    prepMinutes: order.prepMinutes,
    prepMinutesAdded: order.prepMinutesAdded ?? 0,
    readyBy: order.readyBy,
    readyAt: order.readyAt,
    prepBreached: order.prepBreached,
    rejectedReason: order.rejectedReason,
    rejectedNote: order.rejectedNote,
    assignmentStatus: order.assignmentStatus,
    executionPhase: order.executionPhase,
    assignedAt: order.assignedAt,
    assignedPartner: order.assignedPartner,
    /** Same id the helper/task-service live-GPS channel uses (QC order _id). */
    deliveryTaskId: order._id.toString(),
    taskId: order._id.toString(),
    // Delivery-partner snapshot (captured at QR scan) — seller Handover tab + partner app.
    ...((opts.forSeller || opts.forPartner)
      ? {
        partnerName: order.partnerName ?? null,
        partnerPhone: order.partnerPhone ?? null,
        partnerAcceptedAt: order.partnerAcceptedAt ?? null,
        completedAt: order.completedAt ?? null,
      }
      : {}),
    fulfillmentEvents: order.fulfillmentEvents ?? [],
    // Refund ledger is customer-visible (cancelled / rejected orders).
    refunds: (order.refunds ?? []).map((r) => ({
      amount: r.amountPaise / 100,
      amountPaise: r.amountPaise,
      reason: r.reason,
      status: r.status,
      razorpayRefundId: r.razorpayRefundId,
      at: r.at,
      note: r.note,
    })),
    customerReviewSubmitted: Boolean(order.customerReview?.submittedAt),
    customerReview: order.customerReview
      ? {
          deliveryPartnerRating: order.customerReview.deliveryPartnerRating,
          deliveryPartnerUid: order.customerReview.deliveryPartnerUid ?? null,
          deliveryPartnerName: order.customerReview.deliveryPartnerName ?? null,
          itemRatings: (order.customerReview.itemRatings || []).map((r) => ({
            productSlug: r.productSlug,
            name: r.name,
            rating: r.rating,
            description: String(r.description || '').trim() || undefined,
          })),
          submittedAt: order.customerReview.submittedAt,
        }
      : undefined,
    // Order Pickup QR (`pickupQr`) is attached by getSellerOrder / listSellerOrders
    // for seller responses — formatOrder itself doesn't do the lookup.
    customer: { name: order.address?.name, phone: order.address?.phone },
    items: order.items.map((item) => ({
      productSlug: item.productSlug,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPricePaise / 100,
      lineTotal: item.lineTotalPaise / 100,
      unitPricePaise: item.unitPricePaise,
      lineTotalPaise: item.lineTotalPaise,
      imageUrl: item.imageUrl || '',
      mrp: item.mrpPaise != null ? item.mrpPaise / 100 : undefined,
      savings: item.savingsPaise != null ? item.savingsPaise / 100 : undefined,
      preparationChecked: Boolean(item.preparationChecked),
    })),
    address: order.address,
    deliveryInstructions: order.deliveryInstructions,
    partnerTip: order.partnerTipPaise / 100,
    itemTotal: order.itemTotalPaise / 100,
    deliveryFee: order.deliveryFeePaise / 100,
    handlingFee: order.handlingFeePaise / 100,
    partnerTipPaise: order.partnerTipPaise,
    itemTotalPaise: order.itemTotalPaise,
    deliveryFeePaise: order.deliveryFeePaise,
    handlingFeePaise: order.handlingFeePaise,
    couponCode: order.couponCode,
    couponDiscount: order.couponDiscountPaise / 100,
    couponDiscountPaise: order.couponDiscountPaise,
    amount: order.amountPaise / 100,
    amountPaise: order.amountPaise,
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: order.razorpayPaymentId,
    /** Present when payment succeeded — Razorpay Checkout (UPI/card/etc.). */
    paymentMethod: order.razorpayPaymentId ? 'Online' : undefined,
    invoiceNumber: order.invoiceNumber,
    invoiceGeneratedAt: order.invoiceGeneratedAt,
    createdAt: order.createdAt,
  };
}

/** Fulfilment states where the seller wants to see who is delivering the order. */
const PARTNER_VISIBLE_STATES = new Set(['HANDED_OVER', 'COMPLETED']);

/**
 * Resolve delivery-partner profiles (name + phone) for a batch of orders by
 * their `partnerUid` — the order only stores the id, the details live on the
 * user-service Profile. De-duplicates uids, runs the lookups in parallel, and
 * is entirely best-effort: any lookup that fails is simply absent from the map
 * and the caller falls back to the snapshot taken at QR-scan time.
 */
async function resolvePartnerProfiles(
  orders: Array<{
    fulfillmentStatus?: string;
    partnerUid?: string | null;
    partnerName?: string | null;
    partnerPhone?: string | null;
  }>,
): Promise<Map<string, PartnerProfileLite>> {
  const uids = Array.from(
    new Set(
      orders
        .filter(
          (o) =>
            PARTNER_VISIBLE_STATES.has(String(o.fulfillmentStatus)) &&
            o.partnerUid &&
            (!o.partnerName || !o.partnerPhone),
        )
        .map((o) => String(o.partnerUid)),
    ),
  ).slice(0, 25); // in-flight deliveries per store are few; cap the fan-out

  const map = new Map<string, PartnerProfileLite>();
  if (uids.length === 0) return map;

  const results = await Promise.all(
    uids.map((uid) => fetchPartnerProfile(uid).catch(() => null)),
  );
  results.forEach((prof, i) => {
    if (prof) map.set(uids[i], prof);
  });
  return map;
}

function paymentAuthHeaders(): Record<string, string> {
  const token = (env.PAYMENT_SERVICE_AUTH_TOKEN || env.SERVICE_AUTH_TOKEN || '').trim();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Service-Auth': token } : {}),
  };
}

function isPaymentVerifySuccess(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const body = payload as { success?: unknown; data?: { success?: unknown } };
  return body.success === true || body.data?.success === true;
}

async function postPaymentVerify(
  baseUrl: string,
  path: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
): Promise<{ status: number; ok: boolean; payload: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: paymentAuthHeaders(),
      body: JSON.stringify({
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = { raw };
    }
    return { status: response.status, ok: response.ok, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyPaymentWithService(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
): Promise<boolean> {
  const baseUrl = env.PAYMENT_SERVICE_URL?.trim();
  if (!baseUrl) {
    logger.error('qc confirm: PAYMENT_SERVICE_URL unset');
    return false;
  }

  try {
    const signatureResult = await postPaymentVerify(
      baseUrl,
      '/api/v1/payment/verify-signature',
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    );
    if (signatureResult.ok && isPaymentVerifySuccess(signatureResult.payload)) {
      return true;
    }
    logger.warn('qc confirm: verify-signature failed', {
      status: signatureResult.status,
      payload: signatureResult.payload,
      paymentHost: new URL(baseUrl).host,
    });

    // Older payment images only expose verify-payment (task escrow). Grocery has
    // no escrow; payment-service now returns success on HMAC when escrow is missing.
    const paymentResult = await postPaymentVerify(
      baseUrl,
      '/api/v1/payment/verify-payment',
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    );
    if (paymentResult.ok && isPaymentVerifySuccess(paymentResult.payload)) {
      logger.info('qc confirm: verified via verify-payment fallback');
      return true;
    }
    logger.warn('qc confirm: verify-payment fallback failed', {
      status: paymentResult.status,
      payload: paymentResult.payload,
    });
    return false;
  } catch (err) {
    logger.error('qc confirm: payment verify request failed', { err });
    return false;
  }
}

export class QcOrderService {
  static calculateFees(itemTotalPaise: number, partnerTipPaise: number, couponDiscountPaise: number) {
    const deliveryFeePaise =
      itemTotalPaise >= FREE_DELIVERY_THRESHOLD_PAISE ? 0 : DELIVERY_FEE_PAISE;
    const handlingFeePaise = HANDLING_FEE_PAISE;
    const amountPaise = Math.max(
      0,
      itemTotalPaise + deliveryFeePaise + handlingFeePaise + partnerTipPaise - couponDiscountPaise,
    );
    return { deliveryFeePaise, handlingFeePaise, amountPaise };
  }

  /** Preview a discount code against the customer's current cart. No writes. */
  static async validateCoupon(userId: string, code: string, query: StorefrontQuery = {}) {
    if (!code?.trim()) throw new AppError('Enter a code', 400);

    let ctx: OrderContext;
    try {
      ctx = await buildOrderContext(userId, query);
    } catch (e) {
      return {
        valid: false as const,
        reason: 'CART' as CouponReason,
        message: e instanceof AppError ? e.message : 'Your cart is not ready',
      };
    }

    try {
      const resolved = await resolveCoupon(
        String(ctx.sellerSnapshot.sellerId),
        code,
        userId,
        ctx.orderItems,
        ctx.itemTotalPaise,
      );
      return {
        valid: true as const,
        code: resolved.code,
        appliesTo: resolved.appliesTo,
        discountPaise: resolved.discountPaise,
        discount: resolved.discountPaise / 100,
        appliesToProducts: resolved.lines.map((l) => ({
          masterProductId: l.masterProductId,
          name: l.name,
          discountPaise: l.discountPaise,
        })),
        message: `You save ₹${Math.round(resolved.discountPaise / 100)}`,
      };
    } catch (e) {
      if (e instanceof CouponError) {
        return { valid: false as const, reason: e.reason, message: e.message };
      }
      throw e;
    }
  }

  /**
   * Active CODE promotions for the nearby store — shown in the cart coupons sheet.
   * Does not compute cart-specific eligibility; apply/validate still runs on select.
   */
  static async listAvailableCoupons(userId: string, query: StorefrontQuery = {}) {
    let sellerId: string | null = null;
    try {
      const ctx = await buildOrderContext(userId, query);
      sellerId = String(ctx.sellerSnapshot.sellerId);
    } catch {
      // Empty cart / no serviceable store — still try geo seller for browsing codes.
      const store = await StorefrontService.resolveSellerStoreSnapshot(query).catch(() => null);
      sellerId = store?.sellerId ? String(store.sellerId) : null;
    }

    if (!sellerId || !Types.ObjectId.isValid(sellerId)) {
      return { items: [] as const, sellerId: null };
    }

    const now = new Date();
    const promos = await Promotion.find({
      sellerId,
      trigger: 'CODE',
      state: 'ACTIVE',
      code: { $type: 'string', $ne: '' },
      startsAt: { $lte: now },
      endsAt: { $gte: now },
    })
      .sort({ createdAt: -1 })
      .lean();

    const items = promos
      .filter((p) => promotionStatus(p) === 'active')
      .map((p) => {
        const isPercent = p.type === 'PERCENT';
        const valueLabel = isPercent
          ? `${p.value}% OFF`
          : `₹${Math.round(p.value / 100)} OFF`;
        const minOrderPaise = p.minOrderPaise ?? 0;
        const subtitleParts: string[] = [];
        if (p.description?.trim()) subtitleParts.push(p.description.trim());
        if (minOrderPaise > 0) {
          subtitleParts.push(`Min order ₹${Math.round(minOrderPaise / 100)}`);
        }
        if (p.appliesTo === 'PRODUCTS' && (p.productSnapshots?.length || 0) > 0) {
          const names = (p.productSnapshots || []).map((s) => s.name).filter(Boolean);
          if (names.length === 1) subtitleParts.push(`On ${names[0]}`);
          else if (names.length > 1) subtitleParts.push(`On ${names.length} products`);
        }
        return {
          code: String(p.code || '').toUpperCase(),
          title: valueLabel,
          subtitle: subtitleParts.join(' · ') || 'Available offer',
          discountType: isPercent ? ('percentage' as const) : ('flat' as const),
          discountValue: p.value,
          minOrderPaise,
        };
      })
      .filter((item) => Boolean(item.code));

    return { items, sellerId };
  }

  static async checkout(userId: string, input: CheckoutInput, query: StorefrontQuery = {}) {
    const { sellerSnapshot, orderItems, itemTotalPaise } = await buildOrderContext(userId, query);

    const deliveryType: QcDeliveryType =
      String(input.deliveryType || 'EXPRESS').toUpperCase() === 'SCHEDULED'
        ? 'SCHEDULED'
        : 'EXPRESS';

    // Track B — a paused / closed shop does not take NEW express orders.
    // Scheduled remains available during auto-pause (high-demand fallback).
    await reopenExpiredPauses({ sellerId: sellerSnapshot.sellerId }).catch(() => undefined);
    await rolloverRejectionDayIfNeeded(sellerSnapshot.sellerId).catch(() => undefined);
    const shopSettings = await SellerStoreSettings.findOne({ sellerId: sellerSnapshot.sellerId })
      .select('storeStatus autoPausedAt')
      .lean();
    if (shopSettings?.storeStatus === 'CLOSED') {
      throw new AppError('This shop is currently closed', 409);
    }
    if (deliveryType === 'EXPRESS' && shopSettings?.autoPausedAt) {
      throw new AppError(
        'Express is currently unavailable due to high demand. Please schedule a delivery instead.',
        409,
        undefined,
        'EXPRESS_UNAVAILABLE',
      );
    }

    let scheduledSlotId: Types.ObjectId | undefined;
    let scheduledDate: Date | undefined;
    let scheduledTimeStart: string | undefined;
    let scheduledTimeEnd: string | undefined;

    if (deliveryType === 'SCHEDULED') {
      const slotId = String(input.scheduledSlotId || '').trim();
      if (!slotId) {
        throw new AppError(
          'Please select a delivery time slot',
          400,
          undefined,
          'SCHEDULE_SLOT_REQUIRED',
        );
      }
      const held = await QcDeliveryOptionsService.holdSlot({
        slotId,
        sellerId: sellerSnapshot.sellerId,
      });
      scheduledSlotId = held._id as Types.ObjectId;
      scheduledDate = held.startAt;
      scheduledTimeStart = held.startAt.toISOString();
      scheduledTimeEnd = held.endAt.toISOString();
    }

    const partnerTipPaise = Math.max(0, Math.round(Number(input.partnerTipPaise) || 0));

    // Discount code — recomputed server-side from this shop's seller promos only
    // (created in the shopkeeper app). Platform/portal codes are not accepted.
    let couponCode: string | undefined;
    let couponDiscountPaise = 0;
    if (input.couponCode?.trim()) {
      try {
        const resolved = await resolveCoupon(
          String(sellerSnapshot.sellerId),
          input.couponCode,
          userId,
          orderItems,
          itemTotalPaise,
        );
        couponCode = resolved.code;
        couponDiscountPaise = resolved.discountPaise;
      } catch (e) {
        if (e instanceof CouponError) {
          if (scheduledSlotId) {
            await QcDeliveryOptionsService.releaseHold(scheduledSlotId);
          }
          throw new AppError(e.message, 409);
        }
        if (scheduledSlotId) {
          await QcDeliveryOptionsService.releaseHold(scheduledSlotId);
        }
        throw e;
      }
    } else {
      // Legacy path — customer app that hasn't adopted `couponCode` yet.
      couponDiscountPaise = Math.max(0, Math.round(Number(input.couponDiscountPaise) || 0));
    }

    const fees = this.calculateFees(itemTotalPaise, partnerTipPaise, couponDiscountPaise);

    // Reserve stock for this checkout; release scheduled hold if reserve fails.
    try {
      await InventoryService.reserveOrderStock(sellerSnapshot.sellerId, orderItems);
    } catch (e) {
      if (scheduledSlotId) {
        await QcDeliveryOptionsService.releaseHold(scheduledSlotId);
      }
      throw e;
    }

    const orderNumber = generateOrderNumber();
    const normalizedAddress = normalizeCheckoutAddress(input.address);
    const orderLocation = {
      type: 'Point' as const,
      coordinates:
        normalizedAddress.coordinates && normalizedAddress.coordinates.length === 2
          ? (normalizedAddress.coordinates as [number, number])
          : ([0, 0] as [number, number]),
      address: [normalizedAddress.line1, normalizedAddress.line2].filter(Boolean).join(', '),
      city: normalizedAddress.city,
      state: normalizedAddress.state || '',
      pinCode: normalizedAddress.pinCode,
      country: 'India',
      taskArea: normalizedAddress.city,
    };
    const itemCount = orderItems.reduce((sum, it) => sum + it.quantity, 0);

    try {
      const order = await CustomerOrder.create({
        userId,
        sellerId: sellerSnapshot.sellerId,
        shopName: sellerSnapshot.shopName,
        shopCity: sellerSnapshot.shopCity,
        shopImage: sellerSnapshot.shopImage,
        shopImageUrl: sellerSnapshot.shopImageUrl,
        orderNumber,
        status: 'PENDING_PAYMENT',
        paymentStatus: 'PENDING',
        reservationStatus: 'RESERVED',
        deliveryType,
        ...(scheduledSlotId
          ? {
              scheduledSlotId,
              scheduledDate,
              scheduledTimeStart,
              scheduledTimeEnd,
            }
          : {}),
        items: orderItems,
        address: normalizedAddress,
        deliveryInstructions: input.deliveryInstructions || [],
        partnerTipPaise,
        itemTotalPaise,
        deliveryFeePaise: fees.deliveryFeePaise,
        handlingFeePaise: fees.handlingFeePaise,
        couponCode,
        couponDiscountPaise,
        amountPaise: fees.amountPaise,

        // Task Collection Alignment
        title: `Quick Commerce Delivery - Order #${orderNumber}`,
        description: `Deliver ${itemCount} item(s) from ${sellerSnapshot.shopName || 'Store'} to ${normalizedAddress.line1}, ${normalizedAddress.city}`,
        category: 'delivery',
        categorySlug: 'delivery_logistics',
        categoryLabel: 'Delivery & Logistics',
        subcategory: 'quick_commerce_delivery',
        bookingSource: 'quick_commerce',
        bookingOrderId: orderNumber,
        budget: {
          amount: Math.round(fees.amountPaise / 100),
          currency: 'INR',
          type: 'fixed',
        },
        location: orderLocation,
        urgency: deliveryType === 'SCHEDULED' ? 'medium' : 'urgent',
        priority: deliveryType === 'SCHEDULED' ? 'normal' : 'high',
        requesterUid: userId,
        requesterId: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
        assignmentStatus: 'pending',
      });

      return { order: formatOrder(order) };
    } catch (e) {
      if (scheduledSlotId) {
        await QcDeliveryOptionsService.releaseHold(scheduledSlotId);
      }
      throw e;
    }
  }

  static async confirmPayment(
    userId: string,
    orderId: string,
    input: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
  ) {
    const order = await CustomerOrder.findOne({ _id: orderId, userId });
    if (!order) throw new AppError('Order not found', 404);
    if (order.paymentStatus === 'PAID') {
      if (ensureInvoiceOnOrder(order)) await order.save();
      return { order: formatOrder(order) };
    }
    if (order.status !== 'PENDING_PAYMENT') {
      throw new AppError('Order cannot be paid in its current state', 409);
    }

    const verified = await verifyPaymentWithService(
      input.razorpayOrderId,
      input.razorpayPaymentId,
      input.razorpaySignature,
    );
    if (!verified) {
      order.status = 'FAILED';
      order.paymentStatus = 'FAILED';
      if (order.sellerId && order.reservationStatus === 'RESERVED') {
        await InventoryService.releaseOrderStock(order.sellerId, order.items);
        order.reservationStatus = 'RELEASED';
      }
      if (order.deliveryType === 'SCHEDULED' && order.scheduledSlotId) {
        await QcDeliveryOptionsService.releaseHold(order.scheduledSlotId);
      }
      await order.save();
      throw new AppError('Payment verification failed', 402);
    }

    const now = new Date();
    order.status = 'PAID';
    order.paymentStatus = 'PAID';
    order.razorpayOrderId = input.razorpayOrderId;
    order.razorpayPaymentId = input.razorpayPaymentId;
    order.confirmed = true;
    order.confirmedAt = now;
    order.confirmed_at = now;
    order.scheduledDate = order.scheduledDate || now;

    const isScheduled = order.deliveryType === 'SCHEDULED' && Boolean(order.scheduledSlotId);

    if (isScheduled && order.scheduledSlotId) {
      await QcDeliveryOptionsService.confirmHold(order.scheduledSlotId);
    }

    // Hand the order to the seller's fulfilment queue — immediate for Express;
    // Scheduled waits in SCHEDULED until activation near the delivery window.
    if (!order.fulfillmentStatus) {
      if (isScheduled) {
        order.fulfillmentStatus = 'SCHEDULED';
        order.fulfillmentEvents.push({
          action: 'SCHEDULED_PLACED',
          by: 'system',
          at: now,
          meta: {
            scheduledTimeStart: order.scheduledTimeStart,
            scheduledTimeEnd: order.scheduledTimeEnd,
          },
        });
      } else {
        order.fulfillmentStatus = 'PENDING_ACCEPT';
        order.acceptDeadline = new Date(Date.now() + ACCEPT_WINDOW_SECONDS * 1000);
        // Pickup handover is QR-driven now — the QR is minted when the seller marks
        // the order READY (OrderFulfillmentService), not at payment.
        order.fulfillmentEvents.push({ action: 'PLACED', by: 'system', at: now });
      }
    }

    if (!order.title) {
      order.title = `Quick Commerce Order #${order.orderNumber}`;
    }
    if (!order.description) {
      const summary = order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ');
      order.description = `Quick commerce delivery: ${summary}`;
    }
    if (!order.bookingOrderId) {
      order.bookingOrderId = order._id.toString();
    }
    if (!order.bookingItemId) {
      order.bookingItemId = (order.items?.[0] as any)?._id?.toString() || order._id.toString();
    }
    if (!order.bookingSource) {
      order.bookingSource = 'quick_commerce';
    }
    if (!order.category) {
      order.category = 'delivery';
      order.categorySlug = 'delivery_logistics';
      order.categoryLabel = 'Delivery & Logistics';
      order.subcategory = 'quick_commerce_delivery';
    }
    if (!order.budget) {
      const deliveryFee = (order.deliveryFeePaise ?? 0) / 100;
      const totalAmount = (order.amountPaise ?? 0) / 100;
      const amt = deliveryFee > 0 ? deliveryFee : Math.round(totalAmount * 0.1) || 50;
      order.budget = {
        amount: amt,
        min: amt,
        max: amt,
        currency: 'INR',
        type: 'fixed',
      };
    }
    if (!order.scheduledDate && order.deliveryType !== 'SCHEDULED') {
      order.scheduledDate = new Date();
    }
    if (!order.assignmentStatus) {
      order.assignmentStatus = 'pending';
    }
    if (!order.requesterUid) {
      order.requesterUid = userId;
    }
    if (!order.requesterId && Types.ObjectId.isValid(userId)) {
      order.requesterId = new Types.ObjectId(userId);
    }

    if (order.sellerId && (!order.shopCoordinates || !order.shopAddress)) {
      try {
        const sellerOnboard = await SellerOnboarding.findOne({ sellerId: order.sellerId })
          .select('latitude longitude shopName shopType address formattedAddress area locality')
          .lean();
        if (sellerOnboard) {
          if (sellerOnboard.longitude && sellerOnboard.latitude && !order.shopCoordinates) {
            order.shopCoordinates = [sellerOnboard.longitude, sellerOnboard.latitude];
          }
          if (!order.shopAddress) {
            order.shopAddress = sellerOnboard.formattedAddress || sellerOnboard.address;
          }
          if (!order.shopArea) {
            order.shopArea = sellerOnboard.area || sellerOnboard.locality;
          }
          if (!order.shopCategory && sellerOnboard.shopType) {
            order.shopCategory = sellerOnboard.shopType;
          }
        }
      } catch (err) {
        // Non-blocking enrichment
      }
    }

    ensureInvoiceOnOrder(order);
    await order.save();

    await CustomerCart.findOneAndUpdate({ userId }, { items: [] });

    await recordPromotionRedemptions(order);

    if (order.sellerId) {
      try {
        await SellerLedgerService.recordCustomerPayment(order);
      } catch (e) {
        logger.warn('confirmPayment: failed to record customer payment in ledger', {
          orderId: String(order._id),
          err: (e as Error)?.message,
        });
      }

      // Seller + partner notify only when fulfillment starts (Express now;
      // Scheduled on activation near the delivery window).
      if (order.fulfillmentStatus === 'PENDING_ACCEPT') {
        emitNewOrder(order);

        const seller = await Seller.findById(order.sellerId).select('userId fcmTokens').lean();
        if (seller?.userId) {
          const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
          void notifySellerNewOrder({
            sellerUserId: seller.userId,
            sellerId: order.sellerId.toString(),
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            amountRupees: order.amountPaise / 100,
            itemCount,
            acceptDeadline: order.acceptDeadline,
            fcmTokens: seller.fcmTokens ?? [],
          });
        }

        void notifyAvailableQcOrder({
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          sellerId: order.sellerId?.toString(),
          shopName: order.shopName,
          shopCoordinates: order.shopCoordinates,
          shopAddress: order.shopAddress,
          deliveryFee: order.deliveryFeePaise ? Math.round(order.deliveryFeePaise / 100) : 29,
        });
      } else if (order.fulfillmentStatus === 'SCHEDULED') {
        // Inform seller of upcoming scheduled order without starting accept countdown.
        emitNewOrder(order);
      }
    }

    return { order: formatOrder(order) };
  }

  static async abandon(userId: string, orderId: string) {
    const order = await CustomerOrder.findOne({ _id: orderId, userId });
    if (!order) return { abandoned: true };
    if (order.paymentStatus === 'PAID') {
      throw new AppError('Paid orders cannot be abandoned', 409);
    }
    if (order.sellerId && order.reservationStatus === 'RESERVED') {
      await InventoryService.releaseOrderStock(order.sellerId, order.items);
      order.reservationStatus = 'RELEASED';
    }
    if (order.deliveryType === 'SCHEDULED' && order.scheduledSlotId) {
      await QcDeliveryOptionsService.releaseHold(order.scheduledSlotId);
    }
    order.status = 'CANCELLED';
    order.fulfillmentStatus = 'CANCELLED';
    order.paymentStatus = 'FAILED';
    await order.save();
    return { abandoned: true };
  }

  static async listTransactions(
    userId: string,
    opts: {
      limit?: number;
      offset?: number;
      category?: 'all' | 'outgoing' | 'refunds';
      startDate?: string;
      endDate?: string;
    } = {},
  ) {
    const limit = Math.min(100, Math.max(1, Math.round(Number(opts.limit) || 20)));
    const offset = Math.max(0, Math.round(Number(opts.offset) || 0));
    const category = opts.category || 'all';
    const includePayments = category !== 'refunds';
    const includeRefunds = category !== 'outgoing';
    const eventArrays: Record<string, unknown>[] = [];

    if (includePayments) {
      eventArrays.push([
        {
          type: 'payment',
          at: '$createdAt',
          amountPaise: '$amountPaise',
          status: 'completed',
          reference: '$razorpayPaymentId',
        },
      ] as never);
    }
    if (includeRefunds) {
      eventArrays.push({
        $map: {
          input: { $ifNull: ['$refunds', []] },
          as: 'refund',
          in: {
            type: 'refund',
            at: '$$refund.at',
            amountPaise: '$$refund.amountPaise',
            status: {
              $switch: {
                branches: [
                  { case: { $eq: ['$$refund.status', 'ISSUED'] }, then: 'completed' },
                  { case: { $eq: ['$$refund.status', 'FAILED'] }, then: 'failed' },
                ],
                default: 'processing',
              },
            },
            sourceStatus: '$$refund.status',
            reason: '$$refund.reason',
            reference: '$$refund.razorpayRefundId',
            note: '$$refund.note',
          },
        },
      });
    }

    const eventMatch: Record<string, unknown> = {};
    if (opts.startDate) {
      const start = new Date(`${opts.startDate}T00:00:00.000Z`);
      if (!Number.isNaN(start.getTime())) {
        eventMatch.$gte = start;
      }
    }
    if (opts.endDate) {
      const end = new Date(`${opts.endDate}T23:59:59.999Z`);
      if (!Number.isNaN(end.getTime())) {
        eventMatch.$lte = end;
      }
    }

    const pipeline: Record<string, unknown>[] = [
      { $match: { userId, paymentStatus: 'PAID' } },
      {
        $project: {
          orderId: '$_id',
          orderNumber: 1,
          shopName: 1,
          itemCount: { $sum: '$items.quantity' },
          fulfillmentStatus: 1,
          paymentStatus: 1,
          orderStatus: '$status',
          invoiceNumber: 1,
          razorpayOrderId: 1,
          razorpayPaymentId: 1,
          events: { $concatArrays: eventArrays },
        },
      },
      { $unwind: '$events' },
      ...(Object.keys(eventMatch).length
        ? [{ $match: { 'events.at': eventMatch } }]
        : []),
      { $sort: { 'events.at': -1, orderId: -1 } },
      {
        $facet: {
          items: [{ $skip: offset }, { $limit: limit }],
          total: [{ $count: 'value' }],
          totals: [
            {
              $group: {
                _id: '$events.type',
                amountPaise: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$events.type', 'refund'] },
                          { $ne: ['$events.status', 'completed'] },
                        ],
                      },
                      0,
                      '$events.amountPaise',
                    ],
                  },
                },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ];

    const [result] = await CustomerOrder.aggregate(pipeline as never[]);
    const rows = (result?.items || []) as Array<Record<string, unknown>>;
    const transactions = rows.map((row) => {
      const event = row.events as Record<string, unknown>;
      const orderId = String(row.orderId);
      const type = String(event.type);
      const reference = String(event.reference || '').trim();
      const transactionId =
        reference || `qc-${type}-${orderId}-${new Date(String(event.at)).getTime()}`;
      const shopName = String(row.shopName || '').trim() || 'Grocery store';
      const metadata = {
        source: 'quick_commerce',
        qcOrder: true,
        orderId,
        orderNumber: row.orderNumber,
        shopName,
        itemCount: row.itemCount,
        fulfillmentStatus: row.fulfillmentStatus,
        paymentStatus: row.paymentStatus,
        orderStatus: row.orderStatus,
        invoiceNumber: row.invoiceNumber,
        razorpayOrderId: row.razorpayOrderId,
        razorpayPaymentId: row.razorpayPaymentId,
        ...(type === 'refund'
          ? {
            refundReason: event.reason,
            refundStatus: event.sourceStatus,
            latestRefundStatus: event.status,
            totalRefunded: Number(event.amountPaise || 0) / 100,
            note: event.note,
          }
          : {}),
      };
      return {
        id: `qc-${type}-${transactionId}`,
        transactionId,
        ...(type === 'refund'
          ? { refundId: reference || undefined, razorpayRefundId: reference || undefined }
          : {}),
        razorpayPaymentId: row.razorpayPaymentId,
        razorpayOrderId: row.razorpayOrderId,
        type,
        category: type === 'refund' ? 'refunds' : 'payments',
        amount: Number(event.amountPaise || 0) / 100,
        status: event.status,
        title: type === 'refund' ? `Refund from ${shopName}` : shopName,
        description:
          type === 'refund'
            ? `Quick Commerce refund · Order ${row.orderNumber}`
            : `Quick Commerce · Order ${row.orderNumber}`,
        date: event.at,
        createdAt: event.at,
        metadata,
      };
    });

    const totals = (result?.totals || []) as Array<{
      _id: string;
      amountPaise: number;
      count: number;
    }>;
    const paymentTotals = totals.find((row) => row._id === 'payment');
    const refundTotals = totals.find((row) => row._id === 'refund');
    return {
      transactions,
      total: Number(result?.total?.[0]?.value || 0),
      summary: {
        totalSpent: Number(paymentTotals?.amountPaise || 0) / 100,
        totalRefunds: Number(refundTotals?.amountPaise || 0) / 100,
        transactionCount: totals.reduce((sum, row) => sum + Number(row.count || 0), 0),
      },
      limit,
      offset,
    };
  }

  static async listOrders(
    userId: string,
    opts: { filter?: 'all' | 'active' | 'completed' | 'cancelled' } = {},
  ) {
    const orders = await CustomerOrder.find({
      userId,
      // Only real checkouts that completed payment. Abandoned / pending shells stay hidden.
      paymentStatus: 'PAID',
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Lazy settle: handed-over orders become DELIVERED after the ETA buffer.
    const now = Date.now();
    for (const order of orders) {
      const status = String(order.status || '').toUpperCase();
      const fulfillment = String(order.fulfillmentStatus || '').toUpperCase();
      if (
        (status === 'CONFIRMED' || (status === 'PAID' && fulfillment === 'HANDED_OVER')) &&
        fulfillment === 'HANDED_OVER'
      ) {
        const handoverEvent = [...(order.fulfillmentEvents || [])]
          .reverse()
          .find((e) => String(e.action || '').toLowerCase().includes('handed'));
        const handedAt = handoverEvent?.at
          ? new Date(handoverEvent.at).getTime()
          : order.readyAt
            ? new Date(order.readyAt).getTime()
            : NaN;
        if (Number.isFinite(handedAt) && now - handedAt >= AUTO_DELIVER_AFTER_HANDOVER_MS) {
          await CustomerOrder.updateOne(
            { _id: order._id, userId, status: { $in: ['PAID', 'CONFIRMED'] } },
            { $set: { status: 'DELIVERED' } },
          );
          (order as { status: string }).status = 'DELIVERED';
        }
      }
      if (ensureInvoiceOnOrder(order as never)) {
        await CustomerOrder.updateOne(
          { _id: order._id },
          {
            $set: {
              invoiceNumber: (order as { invoiceNumber?: string }).invoiceNumber,
              invoiceGeneratedAt: (order as { invoiceGeneratedAt?: Date }).invoiceGeneratedAt,
            },
          },
        );
      }
    }

    const filter = opts.filter || 'all';
    const filtered =
      filter === 'all'
        ? orders
        : orders.filter((order) => classifyOrderBucket(order) === filter);

    const enriched = await enrichOrdersWithStoreInfo(filtered as never[]);
    const withImages = await enrichOrdersWithItemImages(enriched);
    const withPartners = await enrichOrdersWithAssignedPartner(withImages);
    return {
      items: withPartners.map((order) => formatOrder(order as never)),
      filter,
    };
  }

  static async listSellerOrders(sellerId: string, filter?: { status?: string }) {
    // Lazy expiry — a shopkeeper opening the app late sees timed-out orders
    // already gone, not still "New".
    await OrderTimeoutService.expireStale({ sellerId });

    const query: Record<string, unknown> = {
      sellerId,
      paymentStatus: 'PAID',
    };

    if (filter?.status) {
      const s = String(filter.status).toUpperCase();
      if (s === 'CANCELLED') {
        query.$or = [{ status: 'CANCELLED' }, { fulfillmentStatus: 'CANCELLED' }];
      } else if (s === 'REJECTED') {
        query.fulfillmentStatus = 'REJECTED';
      } else {
        query.$or = [{ status: s }, { fulfillmentStatus: s }];
      }
    }

    const orders = await CustomerOrder.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const enriched = await enrichOrdersWithStoreInfo(orders as never[]);

    const [activeQrs, partnerByUid] = await Promise.all([
      OrderPickupQR.find({ sellerId, status: 'ACTIVE' })
        .select('orderId jti token status')
        .lean(),
      resolvePartnerProfiles(orders as never[]),
    ]);
    const qrByOrder = new Map(activeQrs.map((q) => [String(q.orderId), q]));

    return {
      items: enriched.map((order) => {
        const dto = formatOrder(order as never, { forSeller: true });
        const q = qrByOrder.get(String(dto.id));
        const prof =
          (order as { partnerUid?: string | null }).partnerUid
            ? partnerByUid.get(String((order as { partnerUid?: string | null }).partnerUid))
            : undefined;
        return {
          ...dto,
          ...(prof
            ? {
              partnerName: prof.name ?? dto.partnerName ?? null,
              partnerPhone: prof.phone ?? dto.partnerPhone ?? null,
            }
            : {}),
          pickupQr: q
            ? { token: q.token, jti: q.jti, status: q.status, qrString: `ORDER_PICKUP:${q.token}` }
            : null,
        };
      }),
    };
  }

  static async getSellerOrder(sellerId: string, orderId: string) {
    const order = await CustomerOrder.findOne({
      _id: orderId,
      sellerId,
    }).lean();

    if (!order) {
      const exists = await CustomerOrder.exists({ _id: orderId });
      if (exists) {
        throw new AppError('Forbidden: Access to another shop\'s order is denied', 403);
      }
      throw new AppError('Order not found', 404);
    }

    if (order.paymentStatus === 'PAID') {
      await OrderTimeoutService.autoRejectIfLapsed(order as never);
    }
    const [enriched] = await enrichOrdersWithStoreInfo([order as never]);
    const pickupQr = await OrderPickupService.getOrMintForOrder(
      order as Pick<ICustomerOrder, '_id' | 'sellerId' | 'fulfillmentStatus'>,
    );
    const dto = { ...formatOrder(enriched as never, { forSeller: true }), pickupQr };

    // Handover / Completed detail — resolve "who is delivering this order" from
    // the partner's profile (the order only stores partnerUid). Falls back to the
    // snapshot taken at QR-scan time if the user-service can't be reached.
    const fs = order.fulfillmentStatus;
    if ((fs === 'HANDED_OVER' || fs === 'COMPLETED') && order.partnerUid) {
      if (!order.partnerName || !order.partnerPhone) {
        const prof = await fetchPartnerProfile(String(order.partnerUid)).catch(() => null);
        if (prof) {
          dto.partnerName = prof.name ?? dto.partnerName ?? null;
          dto.partnerPhone = prof.phone ?? dto.partnerPhone ?? null;
          // Opportunistically backfill the snapshot so the orders list is correct too.
          const patch: Record<string, string> = {};
          if (prof.name && !order.partnerName) patch.partnerName = prof.name;
          if (prof.phone && !order.partnerPhone) patch.partnerPhone = prof.phone;
          if (Object.keys(patch).length) {
            void CustomerOrder.updateOne({ _id: order._id }, { $set: patch }).catch(() => undefined);
          }
        }
      }
    }

    return { order: dto };
  }

  static async getOrder(userId: string, orderId: string) {
    const orderDoc = await CustomerOrder.findOne({ _id: orderId, userId });
    if (!orderDoc) throw new AppError('Order not found', 404);
    if (ensureInvoiceOnOrder(orderDoc)) await orderDoc.save();
    const order = orderDoc.toObject();
    const [enriched] = await enrichOrdersWithStoreInfo([order as never]);
    const [withImages] = await enrichOrdersWithItemImages([enriched]);
    const [withPartner] = await enrichOrdersWithAssignedPartner([withImages]);
    return { order: formatOrder(withPartner as never) };
  }

  /** Authoritative invoice payload for a paid order — numbers come from the stored order. */
  static async getInvoice(userId: string, orderId: string) {
    const orderDoc = await CustomerOrder.findOne({ _id: orderId, userId });
    if (!orderDoc) throw new AppError('Order not found', 404);
    if (String(orderDoc.paymentStatus || '').toUpperCase() !== 'PAID') {
      throw new AppError('Invoice is available after payment', 409);
    }
    if (ensureInvoiceOnOrder(orderDoc)) await orderDoc.save();

    const [enriched] = await enrichOrdersWithStoreInfo([orderDoc.toObject() as never]);
    const [withImages] = await enrichOrdersWithItemImages([enriched]);
    const formatted = formatOrder(withImages as never);

    return {
      invoice: {
        invoiceNumber: formatted.invoiceNumber,
        invoiceGeneratedAt: formatted.invoiceGeneratedAt || formatted.createdAt,
        orderId: formatted.id,
        orderNumber: formatted.orderNumber,
        status: formatted.status,
        paymentStatus: formatted.paymentStatus,
        paymentMethod: formatted.paymentMethod,
        razorpayPaymentId: formatted.razorpayPaymentId,
        razorpayOrderId: formatted.razorpayOrderId,
        billTo: {
          name: formatted.address?.name || formatted.customer?.name,
          phone: formatted.address?.phone || formatted.customer?.phone,
          address: formatted.address,
        },
        seller: {
          name: formatted.shopName,
          city: formatted.shopCity,
          address: formatted.shopAddress,
          // GSTIN only when available from backend enrichment — never fabricated.
          gstin: (enriched as { sellerGstin?: string })?.sellerGstin || undefined,
        },
        items: formatted.items.map((item) => ({
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.lineTotal,
        })),
        pricing: {
          itemTotal: formatted.itemTotal,
          deliveryFee: formatted.deliveryFee,
          handlingFee: formatted.handlingFee,
          partnerTip: formatted.partnerTip,
          couponCode: formatted.couponCode,
          couponDiscount: formatted.couponDiscount,
          // Tax not stored on QC orders today — omit rather than invent.
          tax: undefined as number | undefined,
          total: formatted.amount,
        },
        createdAt: formatted.createdAt,
      },
    };
  }

  static async removeFromHistory(userId: string, orderId: string) {
    const order = await CustomerOrder.findOne({ _id: orderId, userId });
    if (!order) throw new AppError('Order not found', 404);

    const removable = ['CANCELLED', 'FAILED', 'DELIVERED'].includes(order.status);
    if (!removable) {
      throw new AppError('Only completed orders can be removed from history', 409);
    }

    await CustomerOrder.deleteOne({ _id: orderId, userId });
    return { deleted: true };
  }

  /**
   * Customer “Rate your experience” — delivery partner + per-item product ratings.
   * Allowed once, only after the order is successfully delivered.
   */
  static async submitCustomerReview(
    userId: string,
    orderId: string,
    input: {
      deliveryPartnerRating: number;
      itemRatings: Array<{ productSlug: string; rating: number; description?: string }>;
    },
  ) {
    const order = await CustomerOrder.findOne({ _id: orderId, userId });
    if (!order) throw new AppError('Order not found', 404);

    const status = String(order.status || '').toUpperCase();
    const fulfillment = String(order.fulfillmentStatus || '').toUpperCase();
    const delivered =
      status === 'DELIVERED' ||
      status === 'COMPLETED' ||
      fulfillment === 'COMPLETED';
    if (!delivered) {
      throw new AppError('You can rate this order after it is delivered', 409);
    }
    if (order.customerReview?.submittedAt) {
      throw new AppError('You have already submitted a review for this order', 409);
    }

    const partnerRating = Math.round(Number(input.deliveryPartnerRating));
    if (!Number.isFinite(partnerRating) || partnerRating < 1 || partnerRating > 5) {
      throw new AppError('Delivery partner rating must be between 1 and 5', 400);
    }

    const rawItems = Array.isArray(input.itemRatings) ? input.itemRatings : [];
    if (rawItems.length === 0) {
      throw new AppError('Please rate at least one item', 400);
    }

    const orderSlugs = new Set(order.items.map((i) => String(i.productSlug)));
    const itemRatings = rawItems.map((row) => {
      const productSlug = String(row?.productSlug || '').trim();
      const rating = Math.round(Number(row?.rating));
      if (!productSlug || !orderSlugs.has(productSlug)) {
        throw new AppError('Invalid product in item ratings', 400);
      }
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        throw new AppError('Each item rating must be between 1 and 5', 400);
      }
      const match = order.items.find((i) => i.productSlug === productSlug);
      const description = String(row?.description || '')
        .trim()
        .slice(0, 500);
      return {
        productSlug,
        name: String(match?.name || productSlug),
        rating,
        ...(description ? { description } : {}),
      };
    });

    // Require a rating for every unique product in the order.
    const uniqueSlugs = Array.from(new Set(order.items.map((i) => String(i.productSlug))));
    const bySlug = new Map(itemRatings.map((r) => [r.productSlug, r]));
    for (const slug of uniqueSlugs) {
      if (!bySlug.has(slug)) {
        throw new AppError('Please rate every item in your order', 400);
      }
    }

    order.customerReview = {
      deliveryPartnerRating: partnerRating,
      deliveryPartnerUid: order.partnerUid || order.assigneeUid || null,
      deliveryPartnerName: order.partnerName || null,
      itemRatings: Array.from(bySlug.values()),
      submittedAt: new Date(),
    };
    order.reviewAt = order.customerReview.submittedAt;
    await order.save();

    return this.getOrder(userId, orderId);
  }

  /**
   * Customer cancel eligibility — keep in sync with mobile `canCancelQcOrder`.
   * Allowed while paid and still at the store; blocked after pickup / out for delivery.
   */
  static canCustomerCancelOrder(order: {
    status?: string | null;
    fulfillmentStatus?: string | null;
    paymentStatus?: string | null;
    executionPhase?: string | null;
  }): { ok: true } | { ok: false; message: string } {
    const status = String(order.status || '').toUpperCase();
    const fulfillment = String(order.fulfillmentStatus || '').toUpperCase();
    const payment = String(order.paymentStatus || '').toUpperCase();
    const phase = String(order.executionPhase || '').toLowerCase();

    if (payment !== 'PAID') {
      return { ok: false, message: 'This order can no longer be cancelled' };
    }
    if (status === 'PENDING_PAYMENT') {
      return { ok: false, message: 'This order can no longer be cancelled' };
    }
    if (
      status === 'CANCELLED' ||
      status === 'FAILED' ||
      status === 'DELIVERED' ||
      status === 'COMPLETED' ||
      fulfillment === 'REJECTED' ||
      fulfillment === 'CANCELLED' ||
      fulfillment === 'COMPLETED'
    ) {
      return { ok: false, message: 'This order can no longer be cancelled' };
    }
    if (fulfillment === 'HANDED_OVER' || status === 'CONFIRMED') {
      return {
        ok: false,
        message: 'This order is already out for delivery and cannot be cancelled',
      };
    }
    if (phase === 'on_the_way' || phase === 'arrived') {
      return {
        ok: false,
        message: 'This order is already out for delivery and cannot be cancelled',
      };
    }

    return { ok: true };
  }

  /** Customer-initiated cancel for paid, not-yet-picked-up grocery orders. */
  static async cancelByCustomer(
    userId: string,
    orderId: string,
    input?: { reason?: string },
  ) {
    const order = await CustomerOrder.findOne({ _id: orderId, userId });
    if (!order) throw new AppError('Order not found', 404);

    const eligibility = this.canCustomerCancelOrder(order);
    if (!eligibility.ok) {
      throw new AppError(eligibility.message, 409);
    }

    const reason = input?.reason?.trim() || undefined;
    const paid = order.paymentStatus === 'PAID';
    order.status = 'CANCELLED';
    order.fulfillmentStatus = 'CANCELLED';
    order.cancelledAt = new Date();
    if (reason) {
      order.cancellationReason = reason;
    }
    if (!paid) {
      order.paymentStatus = 'FAILED';
    }

    // Release reserved stock (same path as seller reject / accept timeout).
    // FINALIZED stock was already deducted on accept — no restore API exists.
    if (order.sellerId && order.reservationStatus === 'RESERVED') {
      await InventoryService.releaseOrderStock(order.sellerId, order.items).catch(() => undefined);
      order.reservationStatus = 'RELEASED';
    }

    if (order.deliveryType === 'SCHEDULED' && order.scheduledSlotId) {
      await QcDeliveryOptionsService.releaseBooked(order.scheduledSlotId);
    }

    // Clear partner assignment so helper apps drop the live job.
    if (
      order.partnerUid ||
      order.assigneeUid ||
      order.partnerId ||
      order.assigneeId ||
      order.assignmentStatus === 'assigned'
    ) {
      order.partnerUid = null;
      order.assigneeUid = null;
      order.partnerId = null;
      order.assigneeId = null;
      order.assignedTo = undefined;
      order.assignmentStatus = 'pending';
    }

    order.fulfillmentEvents.push({
      action: 'CANCELLED_BY_CUSTOMER',
      by: 'customer',
      at: new Date(),
      ...(reason ? { meta: { reason } } : {}),
    });
    await order.save();
    // A cancelled order can never be handed over — kill any live pickup QR.
    await OrderPickupService.revokeForOrder(order._id, 'ORDER_CANCELLED').catch(() => undefined);
    emitOrderUpdated(order); // seller app drops it from the active tabs in real time
    void notifyCustomerOrderCancelled({
      customerUserId: String(order.userId || ''),
      orderId: String(order._id),
      orderNumber: order.orderNumber,
    });

    // Notify the shopkeeper via push and in-app notification
    if (order.sellerId) {
      void Seller.findById(order.sellerId)
        .select('userId')
        .lean()
        .then((s) => {
          if (s?.userId) {
            void notifySellerOrderCancelled({
              sellerUserId: s.userId.toString(),
              orderNumber: order.orderNumber,
              orderId: order._id.toString(),
              reason,
            });
          }
        })
        .catch(() => undefined);
    }

    if (paid) {
      await issueOrderRefund(order._id.toString(), 'CUSTOMER_CANCELLED');
      return this.getOrder(userId, orderId);
    }
    return { order: formatOrder(order) };
  }

  /**
   * Whether the customer may add a post-checkout tip for this order.
   * Paid grocery orders only — not cancelled / rejected / unpaid shells.
   */
  static canCustomerAddPartnerTip(order: {
    paymentStatus?: string;
    status?: string;
    fulfillmentStatus?: string | null;
  }): { ok: true } | { ok: false; message: string } {
    if (order.paymentStatus !== 'PAID') {
      return { ok: false, message: 'Tip is available after the order is paid' };
    }
    const status = String(order.status || '').toUpperCase();
    if (status === 'CANCELLED' || status === 'FAILED') {
      return { ok: false, message: 'This order can no longer receive a tip' };
    }
    const fulfillment = String(order.fulfillmentStatus || '').toUpperCase();
    if (fulfillment === 'CANCELLED' || fulfillment === 'REJECTED') {
      return { ok: false, message: 'This order can no longer receive a tip' };
    }
    return { ok: true };
  }

  /**
   * Confirm a separate Razorpay tip payment and add it to the order tip total.
   * Tip is an incremental charge — it does not mutate the original grocery payment.
   */
  static async confirmPartnerTip(
    userId: string,
    orderId: string,
    input: {
      tipPaise: number;
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
  ) {
    const order = await CustomerOrder.findOne({ _id: orderId, userId });
    if (!order) throw new AppError('Order not found', 404);

    const eligibility = this.canCustomerAddPartnerTip(order);
    if (!eligibility.ok) {
      throw new AppError(eligibility.message, 409);
    }

    const tipPaise = Math.round(Number(input.tipPaise) || 0);
    if (!Number.isFinite(tipPaise) || tipPaise < 100) {
      throw new AppError('Minimum tip is ₹1', 400);
    }
    if (tipPaise > 50_000) {
      throw new AppError('Maximum tip is ₹500', 400);
    }

    const razorpayOrderId = String(input.razorpayOrderId || '').trim();
    const razorpayPaymentId = String(input.razorpayPaymentId || '').trim();
    const razorpaySignature = String(input.razorpaySignature || '').trim();
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new AppError('Payment details are required', 400);
    }

    const existingTips = Array.isArray(order.tipPayments) ? order.tipPayments : [];
    if (existingTips.some((t) => t.razorpayPaymentId === razorpayPaymentId)) {
      return { order: formatOrder(order) };
    }

    const verified = await verifyPaymentWithService(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    );
    if (!verified) {
      throw new AppError('Tip payment verification failed', 402);
    }

    order.partnerTipPaise = Math.max(0, Number(order.partnerTipPaise) || 0) + tipPaise;
    order.amountPaise = Math.max(0, Number(order.amountPaise) || 0) + tipPaise;
    if (!Array.isArray(order.tipPayments)) {
      order.tipPayments = [];
    }
    order.tipPayments.push({
      tipPaise,
      razorpayOrderId,
      razorpayPaymentId,
      at: new Date(),
    });

    // Surface tip in partner task budget when present (delivery fee + tips).
    if (order.budget && typeof order.budget === 'object') {
      const tipRupees = tipPaise / 100;
      const current = Number(order.budget.amount) || 0;
      order.budget.amount = Math.round((current + tipRupees) * 100) / 100;
      if (order.budget.min != null) {
        order.budget.min = Math.round((Number(order.budget.min) + tipRupees) * 100) / 100;
      }
      if (order.budget.max != null) {
        order.budget.max = Math.round((Number(order.budget.max) + tipRupees) * 100) / 100;
      }
    }

    order.fulfillmentEvents.push({
      action: 'PARTNER_TIP_ADDED',
      by: 'system',
      at: new Date(),
      meta: { tipPaise, razorpayPaymentId, source: 'customer' },
    });

    await order.save();
    emitOrderUpdated(order);
    return { order: formatOrder(order) };
  }

  /**
   * Change address while the order is still at the store (before partner pickup).
   * Same status gate as cancel; also re-checks store service radius for the new pin.
   */
  static canCustomerChangeDeliveryAddress(order: {
    status?: string | null;
    fulfillmentStatus?: string | null;
    paymentStatus?: string | null;
    executionPhase?: string | null;
  }): { ok: true } | { ok: false; message: string } {
    const gate = this.canCustomerCancelOrder(order);
    if (gate.ok) return { ok: true };

    const fulfillment = String(order.fulfillmentStatus || '').toUpperCase();
    const phase = String(order.executionPhase || '').toLowerCase();
    if (
      fulfillment === 'HANDED_OVER' ||
      phase === 'on_the_way' ||
      phase === 'arrived' ||
      String(order.status || '').toUpperCase() === 'CONFIRMED'
    ) {
      return {
        ok: false,
        message:
          'Address can’t be changed after the delivery partner has picked up your order',
      };
    }
    return {
      ok: false,
      message: 'Delivery address can no longer be changed for this order',
    };
  }

  static async changeDeliveryAddress(
    userId: string,
    orderId: string,
    rawAddress: CheckoutInput['address'],
  ) {
    const order = await CustomerOrder.findOne({ _id: orderId, userId });
    if (!order) throw new AppError('Order not found', 404);

    const eligibility = this.canCustomerChangeDeliveryAddress(order);
    if (!eligibility.ok) {
      throw new AppError(eligibility.message, 409);
    }

    if (!rawAddress || typeof rawAddress !== 'object') {
      throw new AppError('Delivery address is required', 400);
    }

    const normalizedAddress = normalizeCheckoutAddress(rawAddress);
    if (!normalizedAddress.line1?.trim() || !normalizedAddress.city?.trim() || !normalizedAddress.pinCode?.trim()) {
      throw new AppError('Please provide a complete delivery address', 400);
    }

    const coords = normalizedAddress.coordinates;
    if (!coords || coords.length < 2) {
      throw new AppError('Delivery address must include a map location', 400);
    }
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new AppError('Delivery address location is invalid', 400);
    }

    const sellerId = order.sellerId?.toString();
    if (!sellerId) {
      throw new AppError('This order has no store to validate against', 409);
    }

    const store = await StorefrontService.resolveSellerStoreSnapshot({
      sellerId,
      lat,
      lng,
    }).catch(() => null);

    if (!store?.sellerId || String(store.sellerId) !== sellerId) {
      throw new AppError(
        'This address is outside the store delivery area. Pick a nearby address or cancel the order.',
        409,
      );
    }

    const previous = order.address
      ? {
          line1: order.address.line1,
          city: order.address.city,
          pinCode: order.address.pinCode,
          coordinates: order.address.coordinates,
        }
      : undefined;

    const nextLocation = {
      type: 'Point',
      coordinates: [lng, lat],
      address: [normalizedAddress.line1, normalizedAddress.line2].filter(Boolean).join(', '),
      city: normalizedAddress.city,
      state: normalizedAddress.state || '',
      pinCode: normalizedAddress.pinCode,
      country: 'India',
      taskArea: normalizedAddress.city,
    };

    const itemCount = (order.items || []).reduce((sum, it) => sum + (it.quantity || 0), 0);
    const nextDescription = `Deliver ${itemCount} item(s) from ${order.shopName || 'Store'} to ${normalizedAddress.line1}, ${normalizedAddress.city}`;

    const addressUpdatedEvent = {
      action: 'DELIVERY_ADDRESS_UPDATED',
      by: 'system',
      at: new Date(),
      meta: {
        source: 'customer',
        previous,
        distanceKm: store.distanceKm,
      },
    };

    // Avoid full document validation here so legacy orders with old status values
    // can still update address successfully.
    await CustomerOrder.updateOne(
      { _id: order._id },
      {
        $set: {
          address: normalizedAddress,
          location: nextLocation,
          description: nextDescription,
        },
        $push: {
          fulfillmentEvents: addressUpdatedEvent,
        },
      },
    );

    const updated = await CustomerOrder.findById(order._id);
    if (!updated) throw new AppError('Order not found', 404);

    emitOrderUpdated(updated);
    return { order: formatOrder(updated) };
  }

  /**
   * Sweeper to release reserved stock for orders that were initiated at checkout
   * but never paid within the payment window (e.g. customer closed app or lost connectivity).
   */
  static async expireStalePendingPayments(timeoutMinutes: number = 5): Promise<number> {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);
    const staleOrders = await CustomerOrder.find({
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      reservationStatus: 'RESERVED',
      createdAt: { $lte: cutoff },
    });

    let count = 0;
    for (const order of staleOrders) {
      if (order.sellerId) {
        await InventoryService.releaseOrderStock(order.sellerId, order.items).catch(() => undefined);
      }
      order.reservationStatus = 'RELEASED';
      order.status = 'CANCELLED';
      order.fulfillmentStatus = 'CANCELLED';
      order.paymentStatus = 'FAILED';
      order.fulfillmentEvents.push({
        action: 'PAYMENT_TIMED_OUT',
        by: 'system',
        at: new Date(),
        meta: { reason: `Payment window exceeded (${timeoutMinutes} minutes)` },
      });
      await order.save();
      count++;
    }

    return count;
  }
}

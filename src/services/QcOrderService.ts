import CustomerOrder, { IQcOrderAddress, IQcOrderItem } from '../models/CustomerOrder';
import CustomerCart from '../models/CustomerCart';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import Promotion from '../models/Promotion';
import PromotionRedemption from '../models/PromotionRedemption';
import SellerListing from '../models/SellerListing';
import SellerStoreSettings from '../models/SellerStoreSettings';
import { Types } from 'mongoose';
import { StorefrontService, StorefrontQuery } from './StorefrontService';
import { notifySellerNewOrder } from './QcOrderNotificationService';
import { reopenExpiredPauses, rolloverRejectionDayIfNeeded } from './SellerFulfillmentHealthService';
import { AppError } from '../utils/response';
import { discountForAmount, computePromotionDiscount } from '../utils/promotionMath';
import { promotionStatus } from './PromotionService';
import { env } from '../config/env';
import { ACCEPT_WINDOW_SECONDS } from '../config/orderFulfillment';
import { OrderTimeoutService } from './OrderTimeoutService';
import { issueOrderRefund } from './PaymentService';
import { InventoryService } from './InventoryService';
import { triggerQcAutoAssign } from './TaskServiceClient';

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
}): 'active' | 'completed' | 'cancelled' {
  const status = String(order.status || '').toUpperCase();
  const fulfillment = String(order.fulfillmentStatus || '').toUpperCase();
  if (
    status === 'CANCELLED' ||
    status === 'FAILED' ||
    fulfillment === 'REJECTED' ||
    fulfillment === 'CANCELLED'
  ) {
    return 'cancelled';
  }
  if (status === 'DELIVERED') return 'completed';
  if (['PENDING_PAYMENT', 'PAID', 'CONFIRMED'].includes(status)) return 'active';
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

/** 4-digit pickup code the shopkeeper checks against the delivery partner. */
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
    if (!product?.purchasable || !product.inStock) {
      throw new AppError(`${line.productSlug} is no longer available`, 409);
    }

    if (product.availableQuantity != null && line.quantity > product.availableQuantity) {
      throw new AppError(
        `Cannot order ${line.quantity} of "${product.name}". Only ${product.availableQuantity} available in this shop.`,
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
    { shopName?: string; city?: string; shopAddress?: string }
  >();
  if (sellerIds.length) {
    const rows = await SellerOnboarding.find({
      sellerId: { $in: sellerIds.map((id) => new Types.ObjectId(id)) },
    })
      .select('sellerId shopName city address area locality state pincode')
      .lean();

    for (const row of rows) {
      onboardingBySellerId.set(row.sellerId.toString(), {
        shopName: row.shopName?.trim() || undefined,
        city: row.city?.trim() || undefined,
        shopAddress: formatShopAddress(row) || undefined,
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

function formatOrder(order: {
  _id: { toString(): string };
  orderNumber: string;
  status: string;
  paymentStatus: string;
  sellerId?: { toString(): string };
  shopName?: string;
  shopCity?: string;
  shopAddress?: string;
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
  handoverCode?: string;
  fulfillmentEvents?: Array<{ action: string; by: string; at: Date; meta?: unknown }>;
  refunds?: Array<{ amountPaise: number; reason: string; status: string; razorpayRefundId?: string; at: Date; note?: string }>;
}, opts: { forSeller?: boolean } = {}) {
  return {
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    sellerId: order.sellerId?.toString(),
    shopName: String(order.shopName || '').trim() || 'Grocery store',
    shopCity: order.shopCity,
    shopAddress: String(order.shopAddress || '').trim() || order.shopCity || undefined,
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
    // Pickup code only for seller.
    ...(opts.forSeller ? { handoverCode: order.handoverCode } : {}),
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

async function verifyPaymentWithService(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
): Promise<boolean> {
  const baseUrl = env.PAYMENT_SERVICE_URL?.trim();
  if (!baseUrl) return false;

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/payment/verify-signature`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.PAYMENT_SERVICE_AUTH_TOKEN || env.SERVICE_AUTH_TOKEN
        ? {
            'X-Service-Auth':
              env.PAYMENT_SERVICE_AUTH_TOKEN || env.SERVICE_AUTH_TOKEN,
          }
        : {}),
    },
    body: JSON.stringify({
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    }),
  });

  if (!response.ok) return false;
  const payload = (await response.json()) as { success?: boolean };
  return payload.success === true;
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

    // Track B — a paused / closed shop does not take NEW orders. Existing orders
    // are untouched; only new checkouts are blocked.
    await reopenExpiredPauses({ sellerId: sellerSnapshot.sellerId }).catch(() => undefined);
    await rolloverRejectionDayIfNeeded(sellerSnapshot.sellerId).catch(() => undefined);
    const shopSettings = await SellerStoreSettings.findOne({ sellerId: sellerSnapshot.sellerId })
      .select('storeStatus autoPausedAt')
      .lean();
    if (shopSettings?.autoPausedAt) {
      throw new AppError('This shop has paused orders and is not taking new orders right now', 409);
    }
    if (shopSettings?.storeStatus === 'CLOSED') {
      throw new AppError('This shop is currently closed', 409);
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
        if (e instanceof CouponError) throw new AppError(e.message, 409);
        throw e;
      }
    } else {
      // Legacy path — customer app that hasn't adopted `couponCode` yet.
      couponDiscountPaise = Math.max(0, Math.round(Number(input.couponDiscountPaise) || 0));
    }

    const fees = this.calculateFees(itemTotalPaise, partnerTipPaise, couponDiscountPaise);

    // Reserve required quantity for this specific shop
    await InventoryService.reserveOrderStock(sellerSnapshot.sellerId, orderItems);

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

    const order = await CustomerOrder.create({
      userId,
      sellerId: sellerSnapshot.sellerId,
      shopName: sellerSnapshot.shopName,
      shopCity: sellerSnapshot.shopCity,
      orderNumber,
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      reservationStatus: 'RESERVED',
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
      scheduledDate: new Date(),
      urgency: 'urgent',
      priority: 'high',
      requesterUid: userId,
      requesterId: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
      assignmentStatus: 'pending',
    });

    return { order: formatOrder(order) };
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
      await order.save();
      throw new AppError('Payment verification failed', 402);
    }

    order.status = 'PAID';
    order.paymentStatus = 'PAID';
    order.razorpayOrderId = input.razorpayOrderId;
    order.razorpayPaymentId = input.razorpayPaymentId;
    // Hand the order to the seller's fulfilment queue.
    if (!order.fulfillmentStatus) {
      order.fulfillmentStatus = 'PENDING_ACCEPT';
      order.acceptDeadline = new Date(Date.now() + ACCEPT_WINDOW_SECONDS * 1000);
      order.handoverCode = generateHandoverCode();
      order.fulfillmentEvents.push({ action: 'PLACED', by: 'system', at: new Date() });
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
    if (!order.scheduledDate) {
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

    ensureInvoiceOnOrder(order);
    await order.save();

    await CustomerCart.findOneAndUpdate({ userId }, { items: [] });

    await recordPromotionRedemptions(order);

    if (order.sellerId) {
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
    }

    // Auto-assign a delivery partner to this Quick Commerce order (best-effort)
    void (async () => {
      try {
        let shopCoordinates: [number, number] | undefined;
        if (order.sellerId) {
          const sellerOnboard = await SellerOnboarding.findOne({ sellerId: order.sellerId })
            .select('latitude longitude')
            .lean();
          if (sellerOnboard?.latitude && sellerOnboard?.longitude) {
            shopCoordinates = [sellerOnboard.longitude, sellerOnboard.latitude];
          }
        }

        await triggerQcAutoAssign({
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          sellerId: order.sellerId?.toString(),
          shopName: order.shopName,
          shopCoordinates,
          shopAddress: order.address
            ? [order.address.line1, order.address.line2, order.address.city, order.address.state, order.address.pinCode]
                .filter(Boolean)
                .join(', ')
            : undefined,
        });
      } catch (err) {
        // Best-effort — auto-assign failure must not break payment flow
      }
    })();

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
    order.status = 'CANCELLED';
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
    const orders = await CustomerOrder.find({ userId })
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
    return {
      items: withImages.map((order) => formatOrder(order as never)),
      filter,
    };
  }

  static async listSellerOrders(sellerId: string) {
    // Lazy expiry — a shopkeeper opening the app late sees timed-out orders
    // already gone, not still "New".
    await OrderTimeoutService.expireStale({ sellerId });

    const orders = await CustomerOrder.find({
      sellerId,
      paymentStatus: 'PAID',
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const enriched = await enrichOrdersWithStoreInfo(orders as never[]);
    return {
      items: enriched.map((order) => formatOrder(order as never, { forSeller: true })),
    };
  }

  static async getSellerOrder(sellerId: string, orderId: string) {
    const live = await CustomerOrder.findOne({ _id: orderId, sellerId, paymentStatus: 'PAID' });
    if (live) await OrderTimeoutService.autoRejectIfLapsed(live);

    const order = await CustomerOrder.findOne({
      _id: orderId,
      sellerId,
      paymentStatus: 'PAID',
    }).lean();
    if (!order) throw new AppError('Order not found', 404);
    const [enriched] = await enrichOrdersWithStoreInfo([order as never]);
    return { order: formatOrder(enriched as never, { forSeller: true }) };
  }

  static async getOrder(userId: string, orderId: string) {
    const orderDoc = await CustomerOrder.findOne({ _id: orderId, userId });
    if (!orderDoc) throw new AppError('Order not found', 404);
    if (ensureInvoiceOnOrder(orderDoc)) await orderDoc.save();
    const order = orderDoc.toObject();
    const [enriched] = await enrichOrdersWithStoreInfo([order as never]);
    const [withImages] = await enrichOrdersWithItemImages([enriched]);
    return { order: formatOrder(withImages as never) };
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

  /** Customer-initiated cancel for unpaid or not-yet-delivered active orders. */
  static async cancelByCustomer(
    userId: string,
    orderId: string,
    input?: { reason?: string },
  ) {
    const order = await CustomerOrder.findOne({ _id: orderId, userId });
    if (!order) throw new AppError('Order not found', 404);

    const status = String(order.status || '').toUpperCase();
    if (['CANCELLED', 'FAILED', 'DELIVERED'].includes(status)) {
      throw new AppError('This order can no longer be cancelled', 409);
    }

    const paid = order.paymentStatus === 'PAID';
    order.status = 'CANCELLED';
    if (!paid) {
      order.paymentStatus = 'FAILED';
    }
    if (input?.reason?.trim()) {
      order.fulfillmentEvents.push({
        action: 'CANCELLED_BY_CUSTOMER',
        by: 'customer',
        at: new Date(),
        meta: { reason: input.reason.trim() },
      });
    } else {
      order.fulfillmentEvents.push({
        action: 'CANCELLED_BY_CUSTOMER',
        by: 'customer',
        at: new Date(),
      });
    }
    await order.save();
    if (paid) {
      await issueOrderRefund(order._id.toString(), 'CUSTOMER_CANCELLED');
      return this.getOrder(userId, orderId);
    }
    return { order: formatOrder(order) };
  }
}

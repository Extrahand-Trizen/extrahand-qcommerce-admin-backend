import CustomerOrder, { IQcOrderAddress, IQcOrderItem } from '../models/CustomerOrder';
import CustomerCart from '../models/CustomerCart';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import Promotion from '../models/Promotion';
import PromotionRedemption from '../models/PromotionRedemption';
import SellerListing from '../models/SellerListing';
import { Types } from 'mongoose';
import { StorefrontService, StorefrontQuery } from './StorefrontService';
import { notifySellerNewOrder } from './QcOrderNotificationService';
import { AppError } from '../utils/response';
import { discountForAmount, computePromotionDiscount } from '../utils/promotionMath';
import { promotionStatus } from './PromotionService';
import { env } from '../config/env';

const MIN_ORDER_PAISE = 100;
const FREE_DELIVERY_THRESHOLD_PAISE = 19900;
const DELIVERY_FEE_PAISE = 2900;
const HANDLING_FEE_PAISE = 0;

export type CheckoutInput = {
  address: IQcOrderAddress;
  deliveryInstructions?: string[];
  partnerTipPaise?: number;
  /** New trusted path — the server recomputes the discount from this code. */
  couponCode?: string;
  /** Legacy path (pre-code-redemption customer app) — trusted as-is. */
  couponDiscountPaise?: number;
};

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

/** Look up a discount code and work out what it takes off this cart. Throws
 *  CouponError (with a reason) when it can't be applied. */
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
  if (!promo) throw new CouponError('NOT_FOUND', `"${code}" is not a valid code for this shop`);

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
};

async function enrichOrdersWithStoreInfo<T extends OrderStoreFields>(orders: T[]): Promise<T[]> {
  if (!orders.length) return orders;

  const sellerIds = [
    ...new Set(
      orders
        .map((order) => order.sellerId?.toString())
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const onboardingBySellerId = new Map<string, { shopName?: string; city?: string }>();
  if (sellerIds.length) {
    const rows = await SellerOnboarding.find({
      sellerId: { $in: sellerIds.map((id) => new Types.ObjectId(id)) },
    })
      .select('sellerId shopName city')
      .lean();

    for (const row of rows) {
      onboardingBySellerId.set(row.sellerId.toString(), {
        shopName: row.shopName?.trim() || undefined,
        city: row.city?.trim() || undefined,
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

    return {
      ...order,
      sellerId: order.sellerId || defaultSnapshot?.sellerId,
      shopName,
      shopCity,
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
  createdAt: Date;
  fulfillmentStatus?: string;
  acceptedAt?: Date;
  prepMinutes?: number;
  readyBy?: Date;
  rejectedReason?: string;
  rejectedNote?: string;
  handoverCode?: string;
  fulfillmentEvents?: Array<{ action: string; by: string; at: Date; meta?: unknown }>;
}, opts: { forSeller?: boolean } = {}) {
  return {
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    sellerId: order.sellerId?.toString(),
    shopName: String(order.shopName || '').trim() || 'Grocery store',
    shopCity: order.shopCity,
    // Seller-driven fulfilment lifecycle (see CustomerOrder.QC_FULFILLMENT_STATUS).
    fulfillmentStatus: order.fulfillmentStatus,
    acceptedAt: order.acceptedAt,
    prepMinutes: order.prepMinutes,
    readyBy: order.readyBy,
    rejectedReason: order.rejectedReason,
    rejectedNote: order.rejectedNote,
    fulfillmentEvents: order.fulfillmentEvents ?? [],
    // The pickup code is only ever exposed to the seller, never the customer.
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
    createdAt: order.createdAt,
  };
}

async function verifyPaymentWithService(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
): Promise<boolean> {
  const baseUrl = env.PAYMENT_SERVICE_URL?.trim();
  if (!baseUrl) return true;

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/payment/verify-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.SERVICE_AUTH_TOKEN
        ? { Authorization: `Bearer ${env.SERVICE_AUTH_TOKEN}` }
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

  static async checkout(userId: string, input: CheckoutInput, query: StorefrontQuery = {}) {
    const { sellerSnapshot, orderItems, itemTotalPaise } = await buildOrderContext(userId, query);

    const partnerTipPaise = Math.max(0, Math.round(Number(input.partnerTipPaise) || 0));

    // Discount code — recomputed server-side. When a code is sent, the
    // client-supplied `couponDiscountPaise` is ignored.
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

    const order = await CustomerOrder.create({
      userId,
      sellerId: sellerSnapshot.sellerId,
      shopName: sellerSnapshot.shopName,
      shopCity: sellerSnapshot.shopCity,
      orderNumber: generateOrderNumber(),
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      items: orderItems,
      address: input.address,
      deliveryInstructions: input.deliveryInstructions || [],
      partnerTipPaise,
      itemTotalPaise,
      deliveryFeePaise: fees.deliveryFeePaise,
      handlingFeePaise: fees.handlingFeePaise,
      couponCode,
      couponDiscountPaise,
      amountPaise: fees.amountPaise,
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
      order.handoverCode = generateHandoverCode();
      order.fulfillmentEvents.push({ action: 'PLACED', by: 'system', at: new Date() });
    }
    await order.save();

    await CustomerCart.findOneAndUpdate({ userId }, { items: [] });

    await recordPromotionRedemptions(order);

    if (order.sellerId) {
      const seller = await Seller.findById(order.sellerId).select('userId').lean();
      if (seller?.userId) {
        const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
        void notifySellerNewOrder({
          sellerUserId: seller.userId,
          sellerId: order.sellerId.toString(),
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          amountRupees: order.amountPaise / 100,
          itemCount,
        });
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
    order.status = 'CANCELLED';
    order.paymentStatus = 'FAILED';
    await order.save();
    return { abandoned: true };
  }

  static async listOrders(userId: string) {
    const orders = await CustomerOrder.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const enriched = await enrichOrdersWithStoreInfo(orders as never[]);
    const withImages = await enrichOrdersWithItemImages(enriched);
    return {
      items: withImages.map((order) => formatOrder(order as never)),
    };
  }

  static async listSellerOrders(sellerId: string) {
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
    const order = await CustomerOrder.findOne({ _id: orderId, userId }).lean();
    if (!order) throw new AppError('Order not found', 404);
    const [enriched] = await enrichOrdersWithStoreInfo([order as never]);
    const [withImages] = await enrichOrdersWithItemImages([enriched]);
    return { order: formatOrder(withImages as never) };
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
}

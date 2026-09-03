import CustomerOrder, { IQcOrderAddress } from '../models/CustomerOrder';
import CustomerCart from '../models/CustomerCart';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import { Types } from 'mongoose';
import { StorefrontService, StorefrontQuery } from './StorefrontService';
import { notifySellerNewOrder } from './QcOrderNotificationService';
import { AppError } from '../utils/response';
import { env } from '../config/env';

const MIN_ORDER_PAISE = 100;
const FREE_DELIVERY_THRESHOLD_PAISE = 19900;
const DELIVERY_FEE_PAISE = 2900;
const HANDLING_FEE_PAISE = 0;

export type CheckoutInput = {
  address: IQcOrderAddress;
  deliveryInstructions?: string[];
  partnerTipPaise?: number;
  couponDiscountPaise?: number;
};

function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `QC-${ts}-${rand}`;
}

/** 4-digit pickup code the shopkeeper checks against the delivery partner. */
export function generateHandoverCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
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
  }>;
  address: IQcOrderAddress;
  deliveryInstructions: string[];
  partnerTipPaise: number;
  itemTotalPaise: number;
  deliveryFeePaise: number;
  handlingFeePaise: number;
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

  static async checkout(userId: string, input: CheckoutInput, query: StorefrontQuery = {}) {
    const cart = await CustomerCart.findOne({ userId }).lean();
    if (!cart?.items?.length) {
      throw new AppError('Your cart is empty', 400);
    }

    const sellerSnapshot = await StorefrontService.resolveSellerStoreSnapshot(query);
    if (!sellerSnapshot) {
      throw new AppError('Storefront seller is not available', 503);
    }

    const slugs = cart.items.map((item) => item.productSlug);
    const productMap = await StorefrontService.resolveProductsBySlugs(slugs, query);

    const orderItems: Array<{
      productSlug: string;
      masterProductId: typeof cart.items[0]['masterProductId'];
      name: string;
      unit: string;
      quantity: number;
      unitPricePaise: number;
      lineTotalPaise: number;
      imageUrl?: string;
    }> = [];

    for (const line of cart.items) {
      const product = productMap.get(line.productSlug);
      if (!product?.purchasable || !product.inStock) {
        throw new AppError(`${line.productSlug} is no longer available`, 409);
      }
      const unitPricePaise = Math.round(product.price * 100);
      orderItems.push({
        productSlug: line.productSlug,
        masterProductId: line.masterProductId,
        name: product.name,
        unit: product.unit,
        quantity: line.quantity,
        unitPricePaise,
        lineTotalPaise: unitPricePaise * line.quantity,
        imageUrl: product.imageUrl,
      });
    }

    const itemTotalPaise = orderItems.reduce((sum, item) => sum + item.lineTotalPaise, 0);
    if (itemTotalPaise < MIN_ORDER_PAISE) {
      throw new AppError('Minimum order value is ₹1', 400);
    }
    const partnerTipPaise = Math.max(0, Math.round(Number(input.partnerTipPaise) || 0));
    const couponDiscountPaise = Math.max(0, Math.round(Number(input.couponDiscountPaise) || 0));
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

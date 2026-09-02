import CustomerOrder, { IQcOrderAddress } from '../models/CustomerOrder';
import CustomerCart from '../models/CustomerCart';
import MasterProduct from '../models/MasterProduct';
import { StorefrontService, StorefrontQuery } from './StorefrontService';
import { AppError } from '../utils/response';
import { env } from '../config/env';

const FREE_DELIVERY_THRESHOLD_PAISE = 4900;
const DELIVERY_FEE_PAISE = 2500;
const HANDLING_FEE_PAISE = 900;

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

function formatOrder(order: {
  _id: { toString(): string };
  orderNumber: string;
  status: string;
  paymentStatus: string;
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
}) {
  return {
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    items: order.items.map((item) => ({
      productSlug: item.productSlug,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPricePaise / 100,
      lineTotal: item.lineTotalPaise / 100,
      imageUrl: item.imageUrl || '',
    })),
    address: order.address,
    deliveryInstructions: order.deliveryInstructions,
    partnerTip: order.partnerTipPaise / 100,
    itemTotal: order.itemTotalPaise / 100,
    deliveryFee: order.deliveryFeePaise / 100,
    handlingFee: order.handlingFeePaise / 100,
    couponDiscount: order.couponDiscountPaise / 100,
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
    const partnerTipPaise = Math.max(0, Math.round(Number(input.partnerTipPaise) || 0));
    const couponDiscountPaise = Math.max(0, Math.round(Number(input.couponDiscountPaise) || 0));
    const fees = this.calculateFees(itemTotalPaise, partnerTipPaise, couponDiscountPaise);

    const order = await CustomerOrder.create({
      userId,
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
    await order.save();

    await CustomerCart.findOneAndUpdate({ userId }, { items: [] });

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
    return {
      items: orders.map((order) => formatOrder(order as never)),
    };
  }

  static async getOrder(userId: string, orderId: string) {
    const order = await CustomerOrder.findOne({ _id: orderId, userId }).lean();
    if (!order) throw new AppError('Order not found', 404);
    return { order: formatOrder(order as never) };
  }
}

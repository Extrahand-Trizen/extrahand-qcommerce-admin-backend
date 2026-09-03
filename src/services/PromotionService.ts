import Promotion, { IPromotion } from '../models/Promotion';
import { PromotionType } from '../types';
import { AppError } from '../utils/response';

/* ------------------------------------------------------------------ */
/*  Shape returned to the shopkeeper app (mirrors the app's PromoCode) */
/* ------------------------------------------------------------------ */

export type PromotionStatusDTO =
  | 'active'
  | 'scheduled'
  | 'expired'
  | 'paused'
  | 'exhausted';

export interface PromotionDTO {
  id: string;
  code: string;
  description: string;
  discountType: 'percentage' | 'flat';
  discountValue: number;
  minOrderValuePaise: number;
  maxDiscountPaise?: number;
  usageLimit?: number;
  perCustomerLimit?: number;
  usageCount: number;
  totalDiscountGeneratedPaise: number;
  startsAt: string;
  endsAt: string;
  status: PromotionStatusDTO;
}

/* ------------------------------------------------------------------ */
/*  Validation                                                        */
/* ------------------------------------------------------------------ */

const CODE_RE = /^[A-Z0-9]{3,20}$/;

function parseDate(v: unknown, field: string): Date {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError(`${field} is not a valid date`, 400);
  return d;
}

function posInt(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new AppError(`${field} must be a non-negative whole number`, 400);
  }
  return n;
}

/* ------------------------------------------------------------------ */
/*  Computed status                                                   */
/* ------------------------------------------------------------------ */

function computeStatus(p: IPromotion): PromotionStatusDTO {
  if (p.state === 'PAUSED') return 'paused';
  const now = Date.now();
  if (now < p.startsAt.getTime()) return 'scheduled';
  if (now > p.endsAt.getTime()) return 'expired';
  if (p.usageLimit != null && p.usedCount >= p.usageLimit) return 'exhausted';
  return 'active';
}

function toDTO(p: IPromotion): PromotionDTO {
  return {
    id: String(p._id),
    code: p.code,
    description: p.description ?? '',
    discountType: p.type === 'PERCENT' ? 'percentage' : 'flat',
    discountValue: p.value,
    minOrderValuePaise: p.minOrderPaise ?? 0,
    maxDiscountPaise: p.maxDiscountPaise,
    usageLimit: p.usageLimit,
    perCustomerLimit: p.perCustomerLimit,
    usageCount: p.usedCount,
    totalDiscountGeneratedPaise: p.totalDiscountGivenPaise,
    startsAt: p.startsAt.toISOString(),
    endsAt: p.endsAt.toISOString(),
    status: computeStatus(p),
  };
}

/* ------------------------------------------------------------------ */
/*  Body -> model fields (shared by create + update)                  */
/* ------------------------------------------------------------------ */

interface PromotionBody {
  code?: string;
  description?: string;
  discountType?: string;
  discountValue?: number;
  minOrderValuePaise?: number;
  maxDiscountPaise?: number | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  startsAt?: string;
  endsAt?: string;
}

function applyBody(p: IPromotion, body: PromotionBody, isCreate: boolean): void {
  if (body.code !== undefined) {
    const code = String(body.code).trim().toUpperCase();
    if (!CODE_RE.test(code)) throw new AppError('Code must be 3–20 letters/numbers', 400);
    if (!isCreate && p.usedCount > 0 && code !== p.code) {
      throw new AppError('This code has already been used and cannot be renamed', 400);
    }
    p.code = code;
  }

  if (body.description !== undefined) p.description = String(body.description).trim() || undefined;

  if (body.discountType !== undefined) {
    const t = String(body.discountType).toLowerCase();
    if (t !== 'percentage' && t !== 'flat') throw new AppError('discountType must be "percentage" or "flat"', 400);
    p.type = (t === 'percentage' ? 'PERCENT' : 'FLAT') as PromotionType;
  }

  if (body.discountValue !== undefined) {
    const v = Number(body.discountValue);
    if (!Number.isFinite(v) || v <= 0) throw new AppError('discountValue must be greater than 0', 400);
    if (p.type === 'PERCENT' && v > 100) throw new AppError('A percentage discount cannot exceed 100', 400);
    p.value = p.type === 'PERCENT' ? v : Math.round(v);
  }

  if (body.minOrderValuePaise !== undefined) {
    p.minOrderPaise = body.minOrderValuePaise ? posInt(body.minOrderValuePaise, 'minOrderValuePaise') : undefined;
  }
  if (body.maxDiscountPaise !== undefined) {
    p.maxDiscountPaise = body.maxDiscountPaise ? posInt(body.maxDiscountPaise, 'maxDiscountPaise') : undefined;
  }
  if (body.usageLimit !== undefined) {
    p.usageLimit = body.usageLimit ? Math.max(1, posInt(body.usageLimit, 'usageLimit')) : undefined;
  }
  if (body.perCustomerLimit !== undefined) {
    p.perCustomerLimit = body.perCustomerLimit ? Math.max(1, posInt(body.perCustomerLimit, 'perCustomerLimit')) : undefined;
  }

  if (body.startsAt !== undefined) p.startsAt = parseDate(body.startsAt, 'startsAt');
  if (body.endsAt !== undefined) p.endsAt = parseDate(body.endsAt, 'endsAt');
  if (p.endsAt.getTime() <= p.startsAt.getTime()) {
    throw new AppError('The end date must be after the start date', 400);
  }
  if (p.type === 'FLAT') p.maxDiscountPaise = undefined; // cap only makes sense for %
}

/* ------------------------------------------------------------------ */
/*  Service                                                           */
/* ------------------------------------------------------------------ */

export class PromotionService {
  static async list(sellerId: string, query: { status?: string }) {
    const promos = await Promotion.find({ sellerId }).sort({ createdAt: -1 });
    let items = promos.map(toDTO);
    if (query.status) {
      const wanted = String(query.status).toLowerCase();
      items = items.filter((p) => p.status === wanted);
    }
    return { items, total: items.length };
  }

  static async getOne(sellerId: string, id: string): Promise<PromotionDTO> {
    const p = await Promotion.findOne({ _id: id, sellerId });
    if (!p) throw new AppError('Coupon not found', 404);
    return toDTO(p);
  }

  static async create(sellerId: string, body: PromotionBody): Promise<PromotionDTO> {
    if (!body.code) throw new AppError('code is required', 400);
    if (!body.discountType) throw new AppError('discountType is required', 400);
    if (body.discountValue == null) throw new AppError('discountValue is required', 400);
    if (!body.startsAt || !body.endsAt) throw new AppError('startsAt and endsAt are required', 400);

    const code = String(body.code).trim().toUpperCase();
    const clash = await Promotion.findOne({ sellerId, code });
    if (clash) throw new AppError(`You already have a coupon called "${code}"`, 409);

    const p = new Promotion({ sellerId, code, type: 'PERCENT', value: 1, startsAt: new Date(), endsAt: new Date() });
    applyBody(p, body, true);
    await p.save();
    return toDTO(p);
  }

  static async update(sellerId: string, id: string, body: PromotionBody): Promise<PromotionDTO> {
    const p = await Promotion.findOne({ _id: id, sellerId });
    if (!p) throw new AppError('Coupon not found', 404);

    if (body.code) {
      const code = String(body.code).trim().toUpperCase();
      if (code !== p.code) {
        const clash = await Promotion.findOne({ sellerId, code, _id: { $ne: p._id } });
        if (clash) throw new AppError(`You already have a coupon called "${code}"`, 409);
      }
    }

    applyBody(p, body, false);
    await p.save();
    return toDTO(p);
  }

  static async setState(sellerId: string, id: string, state: 'ACTIVE' | 'PAUSED'): Promise<PromotionDTO> {
    const p = await Promotion.findOne({ _id: id, sellerId });
    if (!p) throw new AppError('Coupon not found', 404);
    p.state = state;
    await p.save();
    return toDTO(p);
  }

  static async remove(sellerId: string, id: string): Promise<{ deleted: true; id: string }> {
    const p = await Promotion.findOne({ _id: id, sellerId });
    if (!p) throw new AppError('Coupon not found', 404);
    if (p.usedCount > 0) {
      throw new AppError('This coupon has been used — pause it instead of deleting', 400);
    }
    await Promotion.deleteOne({ _id: p._id });
    return { deleted: true, id };
  }
}

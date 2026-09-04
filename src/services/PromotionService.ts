import { Types } from 'mongoose';
import Promotion, { IPromotion, IPromotionProductSnapshot } from '../models/Promotion';
import PromotionRedemption from '../models/PromotionRedemption';
import MasterProduct from '../models/MasterProduct';
import SellerListing from '../models/SellerListing';
import ProductImage from '../models/ProductImage';
import { PromotionType, PromotionTrigger, PromotionAppliesTo } from '../types';
import { AppError } from '../utils/response';
import { resolvePublicAssetUrl } from '../utils/media';
import { discountForAmount } from '../utils/promotionMath';

/* ------------------------------------------------------------------ */
/*  Shape returned to the shopkeeper app (mirrors the app's PromoCode) */
/* ------------------------------------------------------------------ */

export type PromotionStatusDTO =
  | 'active'
  | 'scheduled'
  | 'expired'
  | 'paused'
  | 'exhausted';

export interface PromotionProductDTO {
  masterProductId: string;
  name: string;
  slug: string;
}

export interface PromotionDTO {
  id: string;
  trigger: 'code' | 'automatic';
  code: string;
  description: string;
  appliesTo: 'order' | 'products';
  products: PromotionProductDTO[];
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

/** One product's row on the seller "offers overview" screen. */
export interface ProductOfferDTO {
  promotionId: string;
  masterProductId: string;
  listingId: string | null;
  name: string;
  slug: string;
  imageUrl: string;
  trigger: 'code' | 'automatic';
  code?: string;
  discountType: 'percentage' | 'flat';
  discountValue: number;
  listPricePaise: number;
  dealPricePaise: number;
  discountPercent: number;
  startsAt: string;
  endsAt: string;
  status: PromotionStatusDTO;
  unitsSold: number;
  totalDiscountGivenPaise: number;
}

export interface ProductOffersPayload {
  items: ProductOfferDTO[];
  summary: {
    activeOfferCount: number;
    productsOnOfferCount: number;
    totalDiscountGivenPaise: number;
    unitsSoldOnOffer: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Validation                                                        */
/* ------------------------------------------------------------------ */

const CODE_RE = /^[A-Z0-9]{3,20}$/;
const MAX_PRODUCTS_PER_PROMO = 20;

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

type StatusFields = {
  state: string;
  startsAt: Date;
  endsAt: Date;
  usageLimit?: number | null;
  usedCount: number;
};

/** Shared with QcOrderService (coupon validation). Works on a lean doc too. */
export function promotionStatus(p: StatusFields): PromotionStatusDTO {
  if (p.state === 'PAUSED') return 'paused';
  const now = Date.now();
  if (now < new Date(p.startsAt).getTime()) return 'scheduled';
  if (now > new Date(p.endsAt).getTime()) return 'expired';
  if (p.usageLimit != null && p.usedCount >= p.usageLimit) return 'exhausted';
  return 'active';
}

function computeStatus(p: IPromotion): PromotionStatusDTO {
  return promotionStatus(p);
}

function toDTO(p: IPromotion): PromotionDTO {
  return {
    id: String(p._id),
    trigger: p.trigger === 'AUTOMATIC' ? 'automatic' : 'code',
    code: p.code ?? '',
    description: p.description ?? '',
    appliesTo: p.appliesTo === 'PRODUCTS' ? 'products' : 'order',
    products: (p.productSnapshots ?? []).map((s) => ({
      masterProductId: String(s.masterProductId),
      name: s.name,
      slug: s.slug,
    })),
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
  trigger?: string;
  code?: string;
  description?: string;
  appliesTo?: string;
  productMasterIds?: string[];
  discountType?: string;
  discountValue?: number;
  minOrderValuePaise?: number | null;
  maxDiscountPaise?: number | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  startsAt?: string;
  endsAt?: string;
}

/** Load + validate that every id is a MasterProduct the seller currently lists. */
async function resolveProductSnapshots(
  sellerId: string,
  ids: string[],
): Promise<IPromotionProductSnapshot[]> {
  const unique = [...new Set(ids.map((s) => String(s).trim()).filter(Boolean))];
  if (!unique.length) throw new AppError('Select at least one product', 400);
  if (unique.length > MAX_PRODUCTS_PER_PROMO) {
    throw new AppError(`A discount can cover at most ${MAX_PRODUCTS_PER_PROMO} products`, 400);
  }
  const invalid = unique.filter((id) => !Types.ObjectId.isValid(id));
  if (invalid.length) throw new AppError('One or more products are not valid', 400);

  const objectIds = unique.map((id) => new Types.ObjectId(id));
  const listings = await SellerListing.find({
    sellerId,
    masterProductId: { $in: objectIds },
    status: 'ACTIVE',
  })
    .select('masterProductId')
    .lean();
  const listedIds = new Set(listings.map((l) => l.masterProductId.toString()));
  const notListed = unique.filter((id) => !listedIds.has(id));
  if (notListed.length) {
    throw new AppError('Some selected products are not active in your shop', 400);
  }

  const products = await MasterProduct.find({ _id: { $in: objectIds } })
    .select('name slug')
    .lean();
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  return unique.map((id) => {
    const p = byId.get(id);
    if (!p) throw new AppError('A selected product no longer exists', 400);
    return { masterProductId: new Types.ObjectId(id), name: p.name, slug: p.slug };
  });
}

/** Reject a second live AUTOMATIC offer on any of the same products. */
async function assertNoAutomaticOverlap(
  sellerId: string,
  productIds: Types.ObjectId[],
  excludeId?: Types.ObjectId,
): Promise<void> {
  const clash = await Promotion.findOne({
    sellerId,
    trigger: 'AUTOMATIC',
    state: 'ACTIVE',
    productMasterIds: { $in: productIds },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select('productSnapshots')
    .lean();
  if (clash) {
    const names = (clash.productSnapshots ?? []).map((s) => s.name).join(', ');
    throw new AppError(
      `An automatic discount is already running on ${names || 'one of these products'}. Pause it first.`,
      409,
    );
  }
}

async function applyBody(
  p: IPromotion,
  body: PromotionBody,
  sellerId: string,
  isCreate: boolean,
): Promise<void> {
  const locked = !isCreate && p.usedCount > 0;

  if (body.trigger !== undefined) {
    const t = String(body.trigger).toUpperCase();
    if (t !== 'CODE' && t !== 'AUTOMATIC') {
      throw new AppError('trigger must be "code" or "automatic"', 400);
    }
    if (locked && t !== p.trigger) {
      throw new AppError('This discount has been used and its type cannot change', 400);
    }
    p.trigger = t as PromotionTrigger;
  }

  if (body.appliesTo !== undefined) {
    const a = String(body.appliesTo).toUpperCase();
    if (a !== 'ORDER' && a !== 'PRODUCTS') {
      throw new AppError('appliesTo must be "order" or "products"', 400);
    }
    if (locked && a !== p.appliesTo) {
      throw new AppError('This discount has been used and its scope cannot change', 400);
    }
    p.appliesTo = a as PromotionAppliesTo;
  }

  // AUTOMATIC offers are always product-scoped.
  if (p.trigger === 'AUTOMATIC') p.appliesTo = 'PRODUCTS';

  if (body.discountType !== undefined) {
    const t = String(body.discountType).toLowerCase();
    if (t !== 'percentage' && t !== 'flat') {
      throw new AppError('discountType must be "percentage" or "flat"', 400);
    }
    p.type = (t === 'percentage' ? 'PERCENT' : 'FLAT') as PromotionType;
  }

  if (body.discountValue !== undefined) {
    const v = Number(body.discountValue);
    if (!Number.isFinite(v) || v <= 0) throw new AppError('discountValue must be greater than 0', 400);
    if (p.type === 'PERCENT' && v > 100) throw new AppError('A percentage discount cannot exceed 100', 400);
    p.value = p.type === 'PERCENT' ? v : Math.round(v);
  }

  // ---- product scope --------------------------------------------------------
  if (p.appliesTo === 'PRODUCTS') {
    if (body.productMasterIds !== undefined) {
      if (locked) throw new AppError('This discount has been used and its products cannot change', 400);
      const snapshots = await resolveProductSnapshots(sellerId, body.productMasterIds);
      p.productMasterIds = snapshots.map((s) => s.masterProductId);
      p.productSnapshots = snapshots;
    } else if (isCreate || !p.productMasterIds.length) {
      throw new AppError('Select at least one product for this discount', 400);
    } else {
      // Refresh the display snapshot (name/slug may have changed) without touching the set.
      const refreshed = await MasterProduct.find({ _id: { $in: p.productMasterIds } })
        .select('name slug')
        .lean();
      const byId = new Map(refreshed.map((r) => [r._id.toString(), r]));
      p.productSnapshots = p.productMasterIds.map((id) => {
        const r = byId.get(id.toString());
        return { masterProductId: id, name: r?.name ?? '', slug: r?.slug ?? '' };
      });
    }
  } else {
    p.productMasterIds = [];
    p.productSnapshots = [];
  }

  // ---- code ---------------------------------------------------------------
  if (p.trigger === 'CODE') {
    if (body.code !== undefined) {
      const code = String(body.code).trim().toUpperCase();
      if (!CODE_RE.test(code)) throw new AppError('Code must be 3–20 letters/numbers', 400);
      if (locked && code !== p.code) {
        throw new AppError('This code has already been used and cannot be renamed', 400);
      }
      p.code = code;
    }
    if (!p.code) throw new AppError('A discount code is required', 400);
  } else {
    p.code = undefined;
  }

  // ---- code-only knobs ---------------------------------------------------
  if (p.trigger === 'CODE') {
    if (body.minOrderValuePaise !== undefined) {
      p.minOrderPaise = body.minOrderValuePaise ? posInt(body.minOrderValuePaise, 'minOrderValuePaise') : undefined;
    }
    if (body.usageLimit !== undefined) {
      p.usageLimit = body.usageLimit ? Math.max(1, posInt(body.usageLimit, 'usageLimit')) : undefined;
    }
    if (body.perCustomerLimit !== undefined) {
      p.perCustomerLimit = body.perCustomerLimit ? Math.max(1, posInt(body.perCustomerLimit, 'perCustomerLimit')) : undefined;
    }
  } else {
    p.minOrderPaise = undefined;
    p.usageLimit = undefined;
    p.perCustomerLimit = undefined;
  }

  if (body.maxDiscountPaise !== undefined) {
    p.maxDiscountPaise = body.maxDiscountPaise ? posInt(body.maxDiscountPaise, 'maxDiscountPaise') : undefined;
  }

  if (body.description !== undefined) p.description = String(body.description).trim() || undefined;

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
  static async list(sellerId: string, query: { status?: string; trigger?: string }) {
    const filter: Record<string, unknown> = { sellerId };
    if (query.trigger) {
      const t = String(query.trigger).toUpperCase();
      if (t === 'CODE' || t === 'AUTOMATIC') filter.trigger = t;
    }
    const promos = await Promotion.find(filter).sort({ createdAt: -1 });
    let items = promos.map(toDTO);
    if (query.status) {
      const wanted = String(query.status).toLowerCase();
      items = items.filter((p) => p.status === wanted);
    }
    return { items, total: items.length };
  }

  static async getOne(sellerId: string, id: string): Promise<PromotionDTO> {
    const p = await Promotion.findOne({ _id: id, sellerId });
    if (!p) throw new AppError('Discount not found', 404);
    return toDTO(p);
  }

  static async create(sellerId: string, body: PromotionBody): Promise<PromotionDTO> {
    if (body.discountType == null) throw new AppError('discountType is required', 400);
    if (body.discountValue == null) throw new AppError('discountValue is required', 400);
    if (!body.startsAt || !body.endsAt) throw new AppError('startsAt and endsAt are required', 400);

    const trigger = String(body.trigger ?? 'code').toUpperCase() === 'AUTOMATIC' ? 'AUTOMATIC' : 'CODE';

    if (trigger === 'CODE') {
      if (!body.code) throw new AppError('code is required', 400);
      const code = String(body.code).trim().toUpperCase();
      const clash = await Promotion.findOne({ sellerId, code });
      if (clash) throw new AppError(`You already have a discount code called "${code}"`, 409);
    }

    const p = new Promotion({
      sellerId,
      trigger,
      appliesTo: trigger === 'AUTOMATIC' ? 'PRODUCTS' : 'ORDER',
      type: 'PERCENT',
      value: 1,
      startsAt: new Date(),
      endsAt: new Date(),
    });
    await applyBody(p, body, sellerId, true);

    if (p.trigger === 'AUTOMATIC' && p.state === 'ACTIVE') {
      await assertNoAutomaticOverlap(sellerId, p.productMasterIds);
    }

    await p.save();
    return toDTO(p);
  }

  static async update(sellerId: string, id: string, body: PromotionBody): Promise<PromotionDTO> {
    const p = await Promotion.findOne({ _id: id, sellerId });
    if (!p) throw new AppError('Discount not found', 404);

    if (body.code && p.trigger === 'CODE') {
      const code = String(body.code).trim().toUpperCase();
      if (code !== p.code) {
        const clash = await Promotion.findOne({ sellerId, code, _id: { $ne: p._id } });
        if (clash) throw new AppError(`You already have a discount code called "${code}"`, 409);
      }
    }

    await applyBody(p, body, sellerId, false);

    if (p.trigger === 'AUTOMATIC' && p.state === 'ACTIVE') {
      await assertNoAutomaticOverlap(sellerId, p.productMasterIds, p._id as Types.ObjectId);
    }

    await p.save();
    return toDTO(p);
  }

  static async setState(sellerId: string, id: string, state: 'ACTIVE' | 'PAUSED'): Promise<PromotionDTO> {
    const p = await Promotion.findOne({ _id: id, sellerId });
    if (!p) throw new AppError('Discount not found', 404);
    if (state === 'ACTIVE' && p.trigger === 'AUTOMATIC') {
      await assertNoAutomaticOverlap(sellerId, p.productMasterIds, p._id as Types.ObjectId);
    }
    p.state = state;
    await p.save();
    return toDTO(p);
  }

  static async remove(sellerId: string, id: string): Promise<{ deleted: true; id: string }> {
    const p = await Promotion.findOne({ _id: id, sellerId });
    if (!p) throw new AppError('Discount not found', 404);
    if (p.usedCount > 0) {
      throw new AppError('This discount has been used — pause it instead of deleting', 400);
    }
    await Promotion.deleteOne({ _id: p._id });
    return { deleted: true, id };
  }

  /* ---------------------------------------------------------------- */
  /*  Seller offers overview — one row per (promotion, product)        */
  /* ---------------------------------------------------------------- */

  static async listProductOffers(sellerId: string): Promise<ProductOffersPayload> {
    const promos = await Promotion.find({ sellerId, appliesTo: 'PRODUCTS' })
      .sort({ createdAt: -1 })
      .lean();

    if (!promos.length) {
      return {
        items: [],
        summary: {
          activeOfferCount: 0,
          productsOnOfferCount: 0,
          totalDiscountGivenPaise: 0,
          unitsSoldOnOffer: 0,
        },
      };
    }

    const allProductIds = [
      ...new Set(promos.flatMap((p) => (p.productMasterIds ?? []).map((id) => id.toString()))),
    ].map((id) => new Types.ObjectId(id));

    const [listings, images, redemptionRows] = await Promise.all([
      SellerListing.find({ sellerId, masterProductId: { $in: allProductIds } })
        .select('_id masterProductId sellingPricePaise status')
        .lean(),
      ProductImage.find({ masterProductId: { $in: allProductIds } })
        .sort({ isPrimary: -1, displayOrder: 1 })
        .select('masterProductId imageUrl')
        .lean(),
      PromotionRedemption.aggregate<{
        _id: { promotionId: Types.ObjectId; masterProductId: Types.ObjectId };
        units: number;
        discountPaise: number;
      }>([
        { $match: { sellerId: new Types.ObjectId(sellerId) } },
        { $unwind: '$lines' },
        {
          $group: {
            _id: { promotionId: '$promotionId', masterProductId: '$lines.masterProductId' },
            units: { $sum: '$lines.quantity' },
            discountPaise: { $sum: '$lines.discountPaise' },
          },
        },
      ]),
    ]);

    const listingByProduct = new Map(listings.map((l) => [l.masterProductId.toString(), l]));
    const imageByProduct = new Map<string, string>();
    for (const img of images) {
      const key = img.masterProductId.toString();
      if (!imageByProduct.has(key)) imageByProduct.set(key, resolvePublicAssetUrl(img.imageUrl));
    }
    const statsByKey = new Map(
      redemptionRows.map((r) => [
        `${r._id.promotionId.toString()}:${r._id.masterProductId.toString()}`,
        r,
      ]),
    );

    const items: ProductOfferDTO[] = [];
    for (const promo of promos) {
      const status = computeStatus(promo as unknown as IPromotion);
      for (const snap of promo.productSnapshots ?? []) {
        const productId = snap.masterProductId.toString();
        const listing = listingByProduct.get(productId);
        const listPricePaise = listing?.sellingPricePaise ?? 0;
        const perUnit = discountForAmount(
          { type: promo.type, value: promo.value, maxDiscountPaise: promo.maxDiscountPaise },
          listPricePaise,
        );
        const dealPricePaise = Math.max(0, listPricePaise - perUnit);
        const stats = statsByKey.get(`${promo._id.toString()}:${productId}`);
        items.push({
          promotionId: promo._id.toString(),
          masterProductId: productId,
          listingId: listing?._id ? listing._id.toString() : null,
          name: snap.name,
          slug: snap.slug,
          imageUrl: imageByProduct.get(productId) ?? '',
          trigger: promo.trigger === 'AUTOMATIC' ? 'automatic' : 'code',
          code: promo.code,
          discountType: promo.type === 'PERCENT' ? 'percentage' : 'flat',
          discountValue: promo.value,
          listPricePaise,
          dealPricePaise,
          discountPercent:
            listPricePaise > 0 ? Math.round(((listPricePaise - dealPricePaise) / listPricePaise) * 100) : 0,
          startsAt: new Date(promo.startsAt).toISOString(),
          endsAt: new Date(promo.endsAt).toISOString(),
          status,
          unitsSold: stats?.units ?? 0,
          totalDiscountGivenPaise: stats?.discountPaise ?? 0,
        });
      }
    }

    items.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      return b.totalDiscountGivenPaise - a.totalDiscountGivenPaise;
    });

    const activePromoIds = new Set(
      items.filter((i) => i.status === 'active').map((i) => i.promotionId),
    );
    return {
      items,
      summary: {
        activeOfferCount: activePromoIds.size,
        productsOnOfferCount: new Set(
          items.filter((i) => i.status === 'active').map((i) => i.masterProductId),
        ).size,
        totalDiscountGivenPaise: items.reduce((s, i) => s + i.totalDiscountGivenPaise, 0),
        unitsSoldOnOffer: items.reduce((s, i) => s + i.unitsSold, 0),
      },
    };
  }
}

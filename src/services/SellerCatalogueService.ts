import { FilterQuery, Types } from 'mongoose';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import MasterProduct from '../models/MasterProduct';
import ProductImage from '../models/ProductImage';
import ProductTypeAttribute from '../models/ProductTypeAttribute';
import ProductType from '../models/ProductType';
import Attribute from '../models/Attribute';
import SellerListing from '../models/SellerListing';
import PriceReviewLog from '../models/PriceReviewLog';
import ProductSubmission from '../models/ProductSubmission';
import ShopInventory from '../models/ShopInventory';
import Seller from '../models/Seller';
import { notifySellerOutOfStock } from './QcOrderNotificationService';
import logger from '../config/logger';
import { Availability, ProductInformation, PaginationQuery } from '../types';
import Promotion from '../models/Promotion';
import { resolvePublicAssetUrl } from '../utils/media';
import { parsePagination } from '../utils/pagination';
import { AppError } from '../utils/response';
import { discountForAmount } from '../utils/promotionMath';
import { mapStorefrontProductInformation } from '../utils/productInformation';

/* ------------------------------------------------------------------ */
/*  Shapes returned to the shopkeeper app                             */
/* ------------------------------------------------------------------ */

export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  imageUrl?: string;
  displayOrder: number;
}

export interface TaxonomyOptionDTO {
  id: string;
  name: string;
  slug: string;
  displayOrder: number;
}

export interface ProductTypeAttributeDTO {
  id: string;
  name: string;
  key: string;
  type: string;
  description?: string;
  options: Array<{ label: string; value: string; displayOrder: number }>;
  required: boolean;
  displayOrder: number;
  isVariantAttribute: boolean;
}

export interface MasterCatalogueItemDTO {
  id: string;
  name: string;
  brand?: string;
  description?: string;
  categoryId: string;
  categoryName: string;
  subcategoryId: string;
  subcategoryName: string;
  variant: string;
  imageUrl: string;
  sellingPricePaise: number;
  sellingPriceRupees: number;
  addedToStore: boolean;
  listingId: string | null;
}

/** Active AUTOMATIC price drop on a listing — what the customer currently sees. */
export interface SellerListingOfferDTO {
  promotionId: string;
  discountType: 'percentage' | 'flat';
  discountValue: number;
  /** Price the customer pays right now, in paise. */
  dealPricePaise: number;
  dealPriceRupees: number;
  /** Whole-number % off the seller's selling price. */
  discountPercent: number;
  endsAt: string;
}

export interface SellerListingItemDTO {
  id: string;
  masterProductId: string;
  name: string;
  brand?: string;
  categoryId: string;
  categoryName: string;
  variant: string;
  imageUrl: string;
  description?: string;
  notes?: string;
  attributes?: Array<{ attributeId: string; value: any }>;
  productInformation?: Record<string, any>;
  sellingPricePaise: number;
  sellingPriceRupees: number;
  compareAtPricePaise?: number;
  compareAtPriceRupees?: number;
  pendingSellingPricePaise?: number;
  pendingSellingPriceRupees?: number;
  pendingUnit?: string;
  pendingDescription?: string;
  pendingNotes?: string;
  pendingAttributes?: Array<{ attributeId: string; value: any }>;
  pendingProductInformation?: Record<string, any>;
  availability: 'available' | 'limited' | 'out_of_stock';
  stock: number;
  reserved: number;
  available: number;
  /** Shelf life from the master catalogue, e.g. 7 / "Days". */
  lifespanValue?: number;
  lifespanUnit?: string;
  enabled: boolean;
  isCustomProduct?: boolean;
  reviewStatus?: 'approved' | 'under_review' | 'pending_review' | 'rejected' | null;
  rejectionReason?: string;
  /** Present when a live price drop is running on this product. */
  offer?: SellerListingOfferDTO;
}

export interface StoreCategorySummaryDTO {
  id: string;
  name: string;
  slug: string;
  displayOrder: number;
  productCount: number;
}

/** Everything the master catalogue holds for a product — read-only on the
 *  seller side. Shared by the "my product" detail and the "add to store" setup. */
export interface MasterProductDetailDTO {
  name: string;
  brand?: string;
  description?: string;
  sku: string;
  gtin?: string;
  cataloguePricePaise: number;
  cataloguePriceRupees: number;
  categoryName: string;
  subcategoryId: string;
  subcategoryName: string;
  productTypeId?: string;
  productTypeName: string;
  variant: string;
  gallery: string[];
  /** Ordered spec list — every attribute set on the product, with its label. */
  attributes: Array<{ label: string; value: string }>;
  complianceInfo?: string;
  productInformation?: ProductInformation;
  lifespanValue?: number;
  lifespanUnit?: string;
}

/** Full read-only view of one listing: the seller's editable bits + everything
 *  the master catalogue holds for that product. */
export interface SellerListingDetailDTO {
  /** The parts the shopkeeper owns and can change. */
  listing: {
    id: string;
    masterProductId: string;
    sellingPricePaise: number;
    sellingPriceRupees: number;
    compareAtPricePaise?: number;
    compareAtPriceRupees?: number;
    pendingSellingPricePaise?: number;
    pendingSellingPriceRupees?: number;
    pendingUnit?: string;
    description?: string;
    notes?: string;
    attributes?: Array<{ attributeId: string; value: any }>;
    productInformation?: Record<string, any>;
    pendingDescription?: string;
    pendingNotes?: string;
    pendingAttributes?: Array<{ attributeId: string; value: any }>;
    pendingProductInformation?: Record<string, any>;
    availability: 'available' | 'limited' | 'out_of_stock';
    stock: number;
    reserved: number;
    available: number;
    enabled: boolean;
    reviewStatus: 'approved' | 'under_review' | 'pending_review' | 'rejected';
    offer?: SellerListingOfferDTO;
  };
  /** Everything from the master catalogue — read-only on the seller side. */
  master: MasterProductDetailDTO;
}

/* ------------------------------------------------------------------ */
/*  Small mappers                                                     */
/* ------------------------------------------------------------------ */

const toRupees = (paise: number): number => Number((paise / 100).toFixed(2));

const AVAILABILITY_OUT: Record<Availability, SellerListingItemDTO['availability']> = {
  AVAILABLE: 'available',
  LIMITED: 'limited',
  OUT_OF_STOCK: 'out_of_stock',
};

/** Fallback attribute keys, in order, when no attribute is flagged as variant. */
const VARIANT_FALLBACK_KEYS = ['pack_size', 'variant', 'sold_as', 'size'];

function computePendingAttributes(
  newAttrs: any[],
  currentAttrs: any[],
): Array<{ attributeId: string; label: string; value: any }> | null {
  const normNew = (Array.isArray(newAttrs) ? newAttrs : [])
    .map((x) => ({
      attributeId: String(x.attributeId || x.label || x.key || '').trim(),
      label: String(x.label || x.attributeId || x.key || '').trim(),
      value: String(x.value ?? '').trim(),
      rawValue: x.value,
    }))
    .filter((x) => x.label && x.value !== '');

  const currentMap = new Map<string, string>();
  (Array.isArray(currentAttrs) ? currentAttrs : []).forEach((x) => {
    const key = String(x.label || x.attributeId || x.key || '').trim().toLowerCase();
    if (key) {
      currentMap.set(key, String(x.value ?? '').trim());
    }
  });

  const pendingList: Array<{ attributeId: string; label: string; value: any }> = [];

  for (const item of normNew) {
    const keyLower = item.label.toLowerCase();
    const currVal = currentMap.get(keyLower);
    if (currVal === undefined || currVal !== item.value) {
      pendingList.push({
        attributeId: item.attributeId,
        label: item.label,
        value: item.rawValue,
      });
    }
  }

  const newKeysSet = new Set(normNew.map((x) => x.label.toLowerCase()));
  let hasRemovedAttr = false;
  for (const [currKey] of currentMap.entries()) {
    if (!newKeysSet.has(currKey)) {
      hasRemovedAttr = true;
      break;
    }
  }

  if (pendingList.length === 0 && !hasRemovedAttr) {
    return null;
  }

  return pendingList;
}

function computePendingProductInformation(
  newInfo: Record<string, any>,
  currentInfo: Record<string, any>,
): Record<string, any> | null {
  const keys = [
    'ingredients',
    'manufacturer',
    'storageInformation',
    'usageInstructions',
    'allergens',
    'lifespanValue',
    'lifespanUnit',
  ];

  const pendingObj: Record<string, any> = {};
  let hasDiff = false;

  for (const k of keys) {
    const vNew = newInfo && newInfo[k] !== undefined && newInfo[k] !== null ? String(newInfo[k]).trim() : '';
    const vCurr = currentInfo && currentInfo[k] !== undefined && currentInfo[k] !== null ? String(currentInfo[k]).trim() : '';

    if (vNew !== vCurr) {
      hasDiff = true;
      if (newInfo && newInfo[k] !== undefined) {
        pendingObj[k] = newInfo[k];
      }
    }
  }

  return hasDiff ? pendingObj : null;
}

type ActiveOffer = {
  promotionId: string;
  type: 'PERCENT' | 'FLAT';
  value: number;
  maxDiscountPaise?: number;
  endsAt: Date;
};

/** Active AUTOMATIC price drops for a seller, keyed by masterProductId string. */
async function loadActiveOfferMap(
  sellerId: string,
  masterProductIds: Array<Types.ObjectId | string>,
): Promise<Map<string, ActiveOffer>> {
  if (!masterProductIds.length) return new Map();
  const now = new Date();
  const promos = await Promotion.find({
    sellerId,
    trigger: 'AUTOMATIC',
    state: 'ACTIVE',
    startsAt: { $lte: now },
    endsAt: { $gte: now },
    productMasterIds: { $in: masterProductIds },
  })
    .select('type value maxDiscountPaise endsAt productMasterIds')
    .lean();

  const map = new Map<string, ActiveOffer>();
  for (const promo of promos) {
    const info: ActiveOffer = {
      promotionId: String(promo._id),
      type: promo.type,
      value: promo.value,
      maxDiscountPaise: promo.maxDiscountPaise,
      endsAt: promo.endsAt,
    };
    for (const pid of promo.productMasterIds ?? []) {
      const key = pid.toString();
      if (!map.has(key)) map.set(key, info);
    }
  }
  return map;
}

type AttrValue = { attributeId: Types.ObjectId | string; value: unknown };

/* ------------------------------------------------------------------ */
/*  Context builder — resolves everything the mappers need in bulk     */
/* ------------------------------------------------------------------ */

interface CatalogueContext {
  categoryName: Map<string, string>;
  subcategoryName: Map<string, string>;
  /** productTypeId -> ordered list of attributeIds that compose the variant. */
  variantAttrsByType: Map<string, string[]>;
  /** attributeId -> key (for fallback lookups). */
  attrKeyById: Map<string, string>;
  /** attributeId by key (for fallback lookups). */
  attrIdByKey: Map<string, string>;
  /** masterProductId -> absolute primary image url. */
  primaryImage: Map<string, string>;
}

interface CachedTaxonomy {
  cats: Array<{ _id: unknown; name: string }>;
  subs: Array<{ _id: unknown; name: string }>;
  attrs: Array<{ _id: unknown; key: string }>;
  cachedAt: number;
}

const TAXONOMY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let taxonomyCache: CachedTaxonomy | null = null;
let taxonomyFetchPromise: Promise<CachedTaxonomy> | null = null;

export function invalidateTaxonomyCache(): void {
  taxonomyCache = null;
  taxonomyFetchPromise = null;
  logger.info('Taxonomy cache invalidated');
}

async function getCachedTaxonomy(): Promise<{
  cats: Array<{ _id: unknown; name: string }>;
  subs: Array<{ _id: unknown; name: string }>;
  attrs: Array<{ _id: unknown; key: string }>;
}> {
  const now = Date.now();
  if (taxonomyCache && now - taxonomyCache.cachedAt < TAXONOMY_CACHE_TTL_MS) {
    return taxonomyCache;
  }
  if (taxonomyFetchPromise) {
    return taxonomyFetchPromise;
  }

  taxonomyFetchPromise = (async () => {
    try {
      const [cats, subs, attrs] = await Promise.all([
        Category.find({}).select('name').lean(),
        Subcategory.find({}).select('name').lean(),
        Attribute.find({}).select('key').lean(),
      ]);

      taxonomyCache = {
        cats: cats as Array<{ _id: unknown; name: string }>,
        subs: subs as Array<{ _id: unknown; name: string }>,
        attrs: attrs as Array<{ _id: unknown; key: string }>,
        cachedAt: Date.now(),
      };
      return taxonomyCache;
    } finally {
      taxonomyFetchPromise = null;
    }
  })();

  return taxonomyFetchPromise;
}

async function buildContext(products: Array<{ _id: unknown; productTypeId: unknown }>): Promise<CatalogueContext> {
  const productIds = products.map((p) => String(p._id));
  const typeIds = [...new Set(products.map((p) => String(p.productTypeId)))];

  const [{ cats, subs, attrs }, ptAttrs, images] = await Promise.all([
    getCachedTaxonomy(),
    ProductTypeAttribute.find({ productTypeId: { $in: typeIds }, isVariantAttribute: true })
      .select('productTypeId attributeId variantOrder')
      .sort({ variantOrder: 1 })
      .lean(),
    ProductImage.find({ masterProductId: { $in: productIds }, isPrimary: true })
      .select('masterProductId imageUrl')
      .lean(),
  ]);

  const variantAttrsByType = new Map<string, string[]>();
  for (const pa of ptAttrs) {
    const t = String(pa.productTypeId);
    if (!variantAttrsByType.has(t)) variantAttrsByType.set(t, []);
    variantAttrsByType.get(t)!.push(String(pa.attributeId));
  }

  const primaryImage = new Map<string, string>();
  for (const img of images) {
    primaryImage.set(String(img.masterProductId), resolvePublicAssetUrl(img.imageUrl));
  }

  return {
    categoryName: new Map(cats.map((c) => [String(c._id), c.name])),
    subcategoryName: new Map(subs.map((s) => [String(s._id), s.name])),
    variantAttrsByType,
    attrKeyById: new Map(attrs.map((a) => [String(a._id), a.key])),
    attrIdByKey: new Map(attrs.map((a) => [a.key, String(a._id)])),
    primaryImage,
  };
}

function readAttr(attributes: AttrValue[], attributeId: string): string | undefined {
  for (const a of attributes) {
    if (String(a.attributeId) === attributeId) {
      if (a.value === null || a.value === undefined || a.value === '') return undefined;
      if (typeof a.value === 'boolean') return undefined; // booleans are never part of a label
      return String(a.value);
    }
  }
  return undefined;
}

/** Human-readable rendering of a raw attribute value for the read-only spec list.
 *  Maps SELECT option values to their labels; booleans to Yes/No. */
function formatAttrValue(
  raw: unknown,
  options: Array<{ label: string; value: string }>,
): string | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (Array.isArray(raw)) {
    const parts = raw.map((v) => formatAttrValue(v, options)).filter((v): v is string => !!v);
    return parts.length ? parts.join(', ') : undefined;
  }
  const str = String(raw).trim();
  if (!str) return undefined;
  const match = options.find((o) => o.value === str);
  return match ? match.label : str;
}

/** Build the read-only master-catalogue view for one product (lean doc). */
async function buildMasterDetail(
  product: {
    _id: unknown;
    name: string;
    brand?: string;
    description?: string;
    sku: string;
    gtin?: string;
    sellingPricePaise?: number;
    categoryId: unknown;
    subcategoryId: unknown;
    productTypeId: unknown;
    attributes?: AttrValue[];
    complianceInfo?: string;
    productInformation?: ProductInformation | null;
    lifespanValue?: number;
    lifespanUnit?: string;
  },
): Promise<MasterProductDetailDTO> {
  const [category, subcategory, productType, images, typeAttrs, ctx] = await Promise.all([
    Category.findById(product.categoryId as never).select('name').lean(),
    Subcategory.findById(product.subcategoryId as never).select('name').lean(),
    ProductType.findById(product.productTypeId as never).select('name').lean(),
    ProductImage.find({ masterProductId: product._id as never })
      .select('imageUrl isPrimary displayOrder')
      .sort({ isPrimary: -1, displayOrder: 1 })
      .lean(),
    ProductTypeAttribute.find({ productTypeId: product.productTypeId as never })
      .select('attributeId displayOrder')
      .sort({ displayOrder: 1 })
      .lean(),
    buildContext([product as never]),
  ]);

  const attributeIds = [
    ...new Set([
      ...typeAttrs.map((t) => String(t.attributeId)),
      ...(product.attributes ?? []).map((a) => String(a.attributeId)),
    ]),
  ];
  const attrDocs = await Attribute.find({ _id: { $in: attributeIds } })
    .select('name options')
    .lean();
  const attrById = new Map(attrDocs.map((a) => [String(a._id), a]));

  const orderedIds = [
    ...typeAttrs.map((t) => String(t.attributeId)),
    ...attributeIds.filter((id) => !typeAttrs.some((t) => String(t.attributeId) === id)),
  ];
  const attributes: Array<{ label: string; value: string }> = [];
  for (const attrId of orderedIds) {
    const meta = attrById.get(attrId);
    if (!meta) continue;
    const rawEntry = (product.attributes ?? []).find((a) => String(a.attributeId) === attrId);
    if (!rawEntry) continue;
    const value = formatAttrValue(rawEntry.value, meta.options ?? []);
    if (value) attributes.push({ label: meta.name, value });
  }

  return {
    name: product.name,
    brand: product.brand || undefined,
    description: product.description || undefined,
    sku: product.sku,
    gtin: product.gtin || undefined,
    cataloguePricePaise: product.sellingPricePaise ?? 0,
    cataloguePriceRupees: toRupees(product.sellingPricePaise ?? 0),
    categoryName: category?.name ?? '',
    subcategoryId: String(product.subcategoryId),
    subcategoryName: subcategory?.name ?? '',
    productTypeId: product.productTypeId ? String(product.productTypeId) : undefined,
    productTypeName: productType?.name ?? '',
    variant: buildVariant(product as never, ctx),
    gallery: images.map((img) => resolvePublicAssetUrl(img.imageUrl)).filter(Boolean),
    attributes,
    complianceInfo: product.complianceInfo || undefined,
    productInformation: mapStorefrontProductInformation(product.productInformation),
    lifespanValue: product.lifespanValue ?? undefined,
    lifespanUnit: product.lifespanUnit || undefined,
  };
}

/** Compose "1 kg" from the flagged variant attributes, with key-based fallback. */
function buildVariant(
  product: { productTypeId: unknown; attributes: AttrValue[] },
  ctx: CatalogueContext,
): string {
  const flagged = ctx.variantAttrsByType.get(String(product.productTypeId)) ?? [];
  const parts = flagged
    .map((attrId) => readAttr(product.attributes, attrId))
    .filter((v): v is string => !!v);
  if (parts.length) return parts.join(' ');

  for (const key of VARIANT_FALLBACK_KEYS) {
    const attrId = ctx.attrIdByKey.get(key);
    if (!attrId) continue;
    const v = readAttr(product.attributes, attrId);
    if (v) return v;
  }
  return '';
}

/* ------------------------------------------------------------------ */
/*  Service                                                           */
/* ------------------------------------------------------------------ */

export class SellerCatalogueService {
  static async listCategories(): Promise<CategoryDTO[]> {
    const cats = await Category.find({ status: 'ACTIVE' })
      .select('name slug imageUrl displayOrder')
      .sort({ displayOrder: 1, name: 1 })
      .lean();
    return cats.map((c) => ({
      id: String(c._id),
      name: c.name,
      slug: c.slug,
      imageUrl: c.imageUrl,
      displayOrder: c.displayOrder ?? 0,
    }));
  }

  static async listSubcategories(categoryId: string): Promise<TaxonomyOptionDTO[]> {
    if (!categoryId) return [];
    const rows = await Subcategory.find({ categoryId, status: 'ACTIVE' })
      .select('name slug displayOrder')
      .sort({ displayOrder: 1, name: 1 })
      .lean();
    return rows.map((row) => ({
      id: String(row._id),
      name: row.name,
      slug: row.slug,
      displayOrder: row.displayOrder ?? 0,
    }));
  }

  static async listProductTypes(subcategoryId: string): Promise<TaxonomyOptionDTO[]> {
    if (!subcategoryId) return [];
    const rows = await ProductType.find({ subcategoryId, status: 'ACTIVE' })
      .select('name slug displayOrder')
      .sort({ displayOrder: 1, name: 1 })
      .lean();
    return rows.map((row) => ({
      id: String(row._id),
      name: row.name,
      slug: row.slug,
      displayOrder: row.displayOrder ?? 0,
    }));
  }

  static async getProductTypeAttributes(productTypeId: string): Promise<ProductTypeAttributeDTO[]> {
    if (!productTypeId) return [];
    const mappings = await ProductTypeAttribute.find({ productTypeId })
      .populate('attributeId', 'name key type description options isActive')
      .sort({ displayOrder: 1 })
      .lean();

    return mappings
      .filter((mapping) => {
        const attribute = mapping.attributeId as unknown as { isActive?: boolean } | null;
        return Boolean(attribute?.isActive !== false);
      })
      .map((mapping) => {
        const attribute = mapping.attributeId as unknown as {
          _id: unknown;
          name: string;
          key: string;
          type: string;
          description?: string;
          options?: Array<{ label: string; value: string; displayOrder?: number; isActive?: boolean }>;
        };
        return {
          id: String(attribute._id),
          name: attribute.name,
          key: attribute.key,
          type: attribute.type,
          description: attribute.description,
          options: (attribute.options || [])
            .filter((option) => option.isActive !== false)
            .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
            .map((option) => ({
              label: option.label,
              value: option.value,
              displayOrder: option.displayOrder ?? 0,
            })),
          required: Boolean(mapping.isRequired),
          displayOrder: mapping.displayOrder ?? 0,
          isVariantAttribute: Boolean(mapping.isVariantAttribute),
        };
      });
  }

  static async listMasterProducts(
    sellerId: string,
    query: PaginationQuery & { categoryId?: string; subcategoryId?: string },
  ) {
    const { page, limit, skip } = parsePagination(query);

    const filter: FilterQuery<typeof MasterProduct> = { status: 'ACTIVE' };
    if (query.categoryId) filter.categoryId = query.categoryId;
    if (query.subcategoryId) filter.subcategoryId = query.subcategoryId;
    if (query.search?.trim()) {
      filter.$or = [
        { name: { $regex: query.search.trim(), $options: 'i' } },
        { brand: { $regex: query.search.trim(), $options: 'i' } },
      ];
    }

    const [products, total] = await Promise.all([
      MasterProduct.find(filter)
        .select('name brand description categoryId subcategoryId productTypeId attributes sellingPricePaise')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      MasterProduct.countDocuments(filter),
    ]);

    const ctx = await buildContext(products);

    const listings = await SellerListing.find({
      sellerId,
      masterProductId: { $in: products.map((p) => p._id) },
    })
      .select('masterProductId sellingPricePaise')
      .lean();
    const listingByProduct = new Map(
      listings.map((l) => [
        String(l.masterProductId),
        { listingId: String(l._id), sellingPricePaise: l.sellingPricePaise },
      ]),
    );

    const items: MasterCatalogueItemDTO[] = products.map((p) => {
      const id = String(p._id);
      const listing = listingByProduct.get(id);
      // Seller-specific price lives on SellerListing; master product price is only a reference default.
      const sellingPricePaise =
        listing != null ? listing.sellingPricePaise : (p.sellingPricePaise ?? 0);
      return {
        id,
        name: p.name,
        brand: p.brand,
        description: p.description,
        categoryId: String(p.categoryId),
        categoryName: ctx.categoryName.get(String(p.categoryId)) ?? '',
        subcategoryId: String(p.subcategoryId),
        subcategoryName: ctx.subcategoryName.get(String(p.subcategoryId)) ?? '',
        variant: buildVariant(p, ctx),
        imageUrl: ctx.primaryImage.get(id) ?? '',
        sellingPricePaise,
        sellingPriceRupees: toRupees(sellingPricePaise),
        addedToStore: listing != null,
        listingId: listing?.listingId ?? null,
      };
    });

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
  }

  static async listMyListings(
    sellerId: string,
    query: PaginationQuery & { categoryId?: string; subcategoryId?: string; availability?: string; stockStatus?: string },
  ) {
    const { page, limit, skip } = parsePagination(query);

    const listingFilter: FilterQuery<typeof SellerListing> = {
      sellerId: new Types.ObjectId(sellerId),
    };

    if (query.availability) {
      const up = query.availability.toUpperCase();
      if (['AVAILABLE', 'LIMITED', 'OUT_OF_STOCK'].includes(up)) {
        listingFilter.availability = up;
      }
    }

    if (query.stockStatus === 'in_stock') {
      listingFilter.$expr = {
        $gt: [{ $subtract: [{ $ifNull: ['$stock', 0] }, { $ifNull: ['$reserved', 0] }] }, 0],
      };
    } else if (query.stockStatus === 'out_of_stock') {
      listingFilter.$expr = {
        $lte: [{ $subtract: [{ $ifNull: ['$stock', 0] }, { $ifNull: ['$reserved', 0] }] }, 0],
      };
    }

    let total = 0;
    let listings: Array<any> = [];

    const hasCategoryFilter = Boolean(query.categoryId);
    const hasSubcategoryFilter = Boolean(query.subcategoryId);
    const hasSearchFilter = Boolean(query.search?.trim());

    if (!hasCategoryFilter && !hasSubcategoryFilter && !hasSearchFilter) {
      // Fast path: fully index-supported query directly on SellerListing
      const [count, rows] = await Promise.all([
        SellerListing.countDocuments(listingFilter),
        SellerListing.find(listingFilter)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);
      total = count;
      listings = rows;
    } else {
      // Filter path: MongoDB-native aggregation pipeline with lookup on masterproducts
      const productMatch: Record<string, unknown> = {};
      if (hasCategoryFilter) {
        productMatch.categoryId = Types.ObjectId.isValid(query.categoryId!)
          ? new Types.ObjectId(query.categoryId)
          : query.categoryId;
      }
      if (hasSubcategoryFilter) {
        productMatch.subcategoryId = Types.ObjectId.isValid(query.subcategoryId!)
          ? new Types.ObjectId(query.subcategoryId)
          : query.subcategoryId;
      }
      if (hasSearchFilter) {
        const q = query.search!.trim();
        productMatch.$or = [
          { name: { $regex: q, $options: 'i' } },
          { brand: { $regex: q, $options: 'i' } },
        ];
      }

      const pipeline: any[] = [
        { $match: listingFilter },
        {
          $lookup: {
            from: 'masterproducts',
            localField: 'masterProductId',
            foreignField: '_id',
            as: 'product',
            pipeline: [
              { $match: productMatch },
              { $project: { _id: 1 } },
            ],
          },
        },
        { $match: { 'product.0': { $exists: true } } },
        { $sort: { updatedAt: -1 } },
        {
          $facet: {
            totalCount: [{ $count: 'total' }],
            items: [{ $skip: skip }, { $limit: limit }],
          },
        },
      ];

      const [facetResult] = await SellerListing.aggregate(pipeline);
      total = facetResult?.totalCount?.[0]?.total || 0;
      listings = facetResult?.items || [];
    }

    if (!listings.length) {
      return { items: [], total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
    }

    // Now enrich ONLY the paginated slice of listings (at most `limit`, e.g. 20 items)
    const productIds = listings.map((l) => l.masterProductId);
    const [products, offerByProduct, customSubmissions] = await Promise.all([
      MasterProduct.find({ _id: { $in: productIds } })
        .select('name brand description categoryId subcategoryId productTypeId attributes sellingPricePaise lifespanValue lifespanUnit')
        .lean(),
      loadActiveOfferMap(sellerId, productIds),
      ProductSubmission.find({
        sellerId,
        mappedMasterProductId: { $in: productIds },
      })
        .select('mappedMasterProductId status')
        .lean(),
    ]);

    const productById = new Map(products.map((p) => [String(p._id), p]));
    const ctx = await buildContext(products);
    const submissionByProduct = new Map(
      customSubmissions.map((s) => [String(s.mappedMasterProductId), s]),
    );

    const items: SellerListingItemDTO[] = listings
      .filter((l) => productById.has(String(l.masterProductId)))
      .map((l) => {
        const p = productById.get(String(l.masterProductId))!;
        const pid = String(p._id);
        const submission = submissionByProduct.get(pid);
        const isCustomProduct = Boolean(submission);
        const stock = Math.max(0, l.stock ?? 0);
        const reserved = Math.max(0, l.reserved ?? 0);
        const available = Math.max(0, stock - reserved);
        const reviewStatusMapped =
          l.reviewStatus === 'UNDER_REVIEW'
            ? 'under_review'
            : l.reviewStatus === 'PENDING_REVIEW' || submission?.status === 'PENDING'
            ? 'pending_review'
            : l.reviewStatus === 'REJECTED'
            ? 'rejected'
            : 'approved';

        const item: SellerListingItemDTO = {
          id: String(l._id),
          masterProductId: pid,
          name: p.name,
          brand: p.brand,
          categoryId: String(p.categoryId),
          categoryName: ctx.categoryName.get(String(p.categoryId)) ?? '',
          variant: buildVariant(p, ctx),
          imageUrl: ctx.primaryImage.get(pid) ?? '',
          description: l.customDescription ?? p.description,
          notes: l.customNotes ?? undefined,
          attributes: l.customAttributes
            ? l.customAttributes.map((a: any) => ({ attributeId: String(a.attributeId || a.label), value: a.value, label: a.label || String(a.attributeId) }))
            : p.attributes
            ? p.attributes.map((a: any) => ({ attributeId: String(a.label), value: a.value, label: String(a.label) }))
            : undefined,
          productInformation: l.customProductInformation ?? p.productInformation,
          sellingPricePaise: l.sellingPricePaise,
          sellingPriceRupees: toRupees(l.sellingPricePaise),
          pendingSellingPricePaise: l.pendingSellingPricePaise ?? undefined,
          pendingSellingPriceRupees: l.pendingSellingPricePaise != null ? toRupees(l.pendingSellingPricePaise) : undefined,
          pendingUnit: l.pendingUnit ?? undefined,
          pendingDescription: l.pendingDescription ?? undefined,
          pendingNotes: l.pendingNotes ?? undefined,
          pendingAttributes: l.pendingAttributes
            ? l.pendingAttributes.map((a: any) => ({ attributeId: String(a.attributeId || a.label), value: a.value, label: a.label || String(a.attributeId) }))
            : undefined,
          pendingProductInformation: l.pendingProductInformation ?? undefined,
          availability: AVAILABILITY_OUT[l.availability as Availability] ?? 'available',
          stock,
          reserved,
          available,
          lifespanValue: p.lifespanValue ?? undefined,
          lifespanUnit: p.lifespanUnit || undefined,
          enabled: l.status === 'ACTIVE',
          isCustomProduct,
          reviewStatus: reviewStatusMapped,
          rejectionReason: l.rejectionReason ?? undefined,
        };
        if (l.compareAtPricePaise != null) {
          item.compareAtPricePaise = l.compareAtPricePaise;
          item.compareAtPriceRupees = toRupees(l.compareAtPricePaise);
        }
        const promo = offerByProduct.get(pid);
        if (promo) {
          const off = discountForAmount(promo, l.sellingPricePaise);
          if (off > 0) {
            const dealPricePaise = l.sellingPricePaise - off;
            item.offer = {
              promotionId: promo.promotionId,
              discountType: promo.type === 'PERCENT' ? 'percentage' : 'flat',
              discountValue: promo.value,
              dealPricePaise,
              dealPriceRupees: toRupees(dealPricePaise),
              discountPercent:
                l.sellingPricePaise > 0
                  ? Math.round((off / l.sellingPricePaise) * 100)
                  : 0,
              endsAt: promo.endsAt.toISOString(),
            };
          }
        }
        return item;
      })
      .filter(Boolean) as SellerListingItemDTO[];

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Categories that have at least one listing for this seller's store. */
  static async listStoreCategories(sellerId: string): Promise<StoreCategorySummaryDTO[]> {
    const sellerObjId = Types.ObjectId.isValid(sellerId) ? new Types.ObjectId(sellerId) : sellerId;
    const results = await SellerListing.aggregate([
      { $match: { sellerId: sellerObjId } },
      {
        $lookup: {
          from: 'masterproducts',
          localField: 'masterProductId',
          foreignField: '_id',
          as: 'product',
          pipeline: [{ $project: { categoryId: 1 } }],
        },
      },
      { $unwind: '$product' },
      { $group: { _id: '$product.categoryId', productCount: { $sum: 1 } } },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'category',
          pipeline: [
            { $match: { status: 'ACTIVE' } },
            { $project: { name: 1, slug: 1, displayOrder: 1 } },
          ],
        },
      },
      { $unwind: '$category' },
      { $sort: { 'category.displayOrder': 1, 'category.name': 1 } },
      {
        $project: {
          id: { $toString: '$_id' },
          name: '$category.name',
          slug: '$category.slug',
          displayOrder: { $ifNull: ['$category.displayOrder', 0] },
          productCount: 1,
        },
      },
    ]);

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      displayOrder: r.displayOrder ?? 0,
      productCount: r.productCount,
    }));
  }

  /** One listing, fully expanded: the seller's editable fields + all read-only
   *  master-catalogue data (specs, product info, gallery, compliance, …). */
  static async getListingDetail(
    sellerId: string,
    listingId: string,
  ): Promise<SellerListingDetailDTO> {
    if (!Types.ObjectId.isValid(listingId)) throw new AppError('Product not found', 404);

    const listing = await SellerListing.findOne({ _id: listingId, sellerId }).lean();
    if (!listing) throw new AppError('Product not found', 404);

    const product = await MasterProduct.findById(listing.masterProductId).lean();
    if (!product) throw new AppError('Product not found', 404);

    const [master, offerMap] = await Promise.all([
      buildMasterDetail(product),
      loadActiveOfferMap(sellerId, [listing.masterProductId]),
    ]);

    const promo = offerMap.get(String(listing.masterProductId));
    let offer: SellerListingOfferDTO | undefined;
    if (promo) {
      const off = discountForAmount(promo, listing.sellingPricePaise);
      if (off > 0) {
        const dealPricePaise = listing.sellingPricePaise - off;
        offer = {
          promotionId: promo.promotionId,
          discountType: promo.type === 'PERCENT' ? 'percentage' : 'flat',
          discountValue: promo.value,
          dealPricePaise,
          dealPriceRupees: toRupees(dealPricePaise),
          discountPercent:
            listing.sellingPricePaise > 0
              ? Math.round((off / listing.sellingPricePaise) * 100)
              : 0,
          endsAt: promo.endsAt.toISOString(),
        };
      }
    }

    const stock = Math.max(0, listing.stock ?? 0);
    const reserved = Math.max(0, listing.reserved ?? 0);
    const available = Math.max(0, stock - reserved);

    const reviewStatusMapped =
      listing.reviewStatus === 'UNDER_REVIEW'
        ? 'under_review'
        : listing.reviewStatus === 'PENDING_REVIEW'
        ? 'pending_review'
        : listing.reviewStatus === 'REJECTED'
        ? 'rejected'
        : 'approved';

    return {
      listing: {
        id: String(listing._id),
        masterProductId: String(listing.masterProductId),
        sellingPricePaise: listing.sellingPricePaise,
        sellingPriceRupees: toRupees(listing.sellingPricePaise),
        ...(listing.compareAtPricePaise != null
          ? {
              compareAtPricePaise: listing.compareAtPricePaise,
              compareAtPriceRupees: toRupees(listing.compareAtPricePaise),
            }
          : {}),
        pendingSellingPricePaise: listing.pendingSellingPricePaise ?? undefined,
        pendingSellingPriceRupees: listing.pendingSellingPricePaise != null ? toRupees(listing.pendingSellingPricePaise) : undefined,
        pendingUnit: listing.pendingUnit ?? undefined,
        description: listing.customDescription ?? master.description,
        notes: listing.customNotes ?? undefined,
        attributes: listing.customAttributes
          ? listing.customAttributes.map((a: any) => ({ attributeId: String(a.attributeId || a.label), value: a.value, label: a.label || String(a.attributeId) }))
          : master.attributes
          ? master.attributes.map((a: any) => ({ attributeId: String(a.label), value: a.value, label: String(a.label) }))
          : undefined,
        productInformation: listing.customProductInformation ?? master.productInformation,
        pendingDescription: listing.pendingDescription ?? undefined,
        pendingNotes: listing.pendingNotes ?? undefined,
        pendingAttributes: listing.pendingAttributes
          ? listing.pendingAttributes.map((a: any) => ({ attributeId: String(a.attributeId || a.label), value: a.value, label: a.label || String(a.attributeId) }))
          : undefined,
        pendingProductInformation: listing.pendingProductInformation ?? undefined,
        availability: AVAILABILITY_OUT[listing.availability as Availability] ?? 'available',
        stock,
        reserved,
        available,
        enabled: listing.status === 'ACTIVE',
        reviewStatus: reviewStatusMapped,
        offer,
      },
      master,
    };
  }

  /** All read-only master-catalogue data for a product the seller has NOT added
   *  yet — powers the "Add to store" setup screen. */
  static async getMasterProductDetail(masterProductId: string): Promise<MasterProductDetailDTO> {
    if (!Types.ObjectId.isValid(masterProductId)) throw new AppError('Product not found', 404);
    const product = await MasterProduct.findOne({
      _id: masterProductId,
      status: 'ACTIVE',
    }).lean();
    if (!product) throw new AppError('Product not found', 404);
    return buildMasterDetail(product);
  }

  /* ---------------------------------------------------------------- */
  /*  Mutations                                                       */
  /* ---------------------------------------------------------------- */

  private static normalizeAvailability(value?: string): Availability | undefined {
    if (!value) return undefined;
    const up = value.toUpperCase().replace(/-/g, '_');
    return (['AVAILABLE', 'LIMITED', 'OUT_OF_STOCK'] as const).includes(up as Availability)
      ? (up as Availability)
      : undefined;
  }

  /** Add one master product to the seller's store. */
  static async addListing(
    sellerId: string,
    input: { masterProductId: string; sellingPricePaise?: number; availability?: string; stock?: number },
  ): Promise<SellerListingItemDTO> {
    const master = await MasterProduct.findById(input.masterProductId).select('sellingPricePaise status');
    if (!master || master.status !== 'ACTIVE') throw new AppError('Product not found in catalogue', 404);

    const existing = await SellerListing.findOne({ sellerId, masterProductId: input.masterProductId });
    if (existing) throw new AppError('Product already in your store', 409);

    const stock = Math.max(0, Math.round(Number(input.stock) || 0));
    const availability = input.availability
      ? this.normalizeAvailability(input.availability)
      : (stock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK');

    const inputPricePaise =
      input.sellingPricePaise != null && input.sellingPricePaise >= 0
        ? Math.round(input.sellingPricePaise)
        : master.sellingPricePaise;

    const isPriceChanged = inputPricePaise !== master.sellingPricePaise;

    const listing = await SellerListing.create({
      sellerId,
      masterProductId: input.masterProductId,
      sellingPricePaise: master.sellingPricePaise,
      pendingSellingPricePaise: isPriceChanged ? inputPricePaise : undefined,
      availability: availability ?? 'AVAILABLE',
      stock,
      reserved: 0,
      status: 'ACTIVE',
      reviewStatus: isPriceChanged ? 'UNDER_REVIEW' : 'APPROVED',
      reviewSubmittedAt: isPriceChanged ? new Date() : undefined,
    });

    await ShopInventory.findOneAndUpdate(
      { sellerId: listing.sellerId, listingId: listing._id },
      {
        sellerId: listing.sellerId,
        listingId: listing._id,
        masterProductId: listing.masterProductId,
        stock,
        reserved: 0,
      },
      { upsert: true, new: true },
    );

    const one = await this.listMyListings(sellerId, { limit: 1000 });
    return one.items.find((i) => i.id === String(listing._id))!;
  }

  /** Add many at once. Skips products already in the store. */
  static async addListingsBulk(
    sellerId: string,
    body: {
      items: Array<{ masterProductId: string; sellingPricePaise?: number; stock?: number }>;
      defaults?: { availability?: string; stock?: number };
    },
  ) {
    const ids = [...new Set((body.items || []).map((i) => i.masterProductId))];
    if (!ids.length) throw new AppError('No items provided', 400);

    const masters = await MasterProduct.find({ _id: { $in: ids }, status: 'ACTIVE' })
      .select('sellingPricePaise')
      .lean();
    const masterById = new Map(masters.map((m) => [String(m._id), m]));

    const already = await SellerListing.find({ sellerId, masterProductId: { $in: ids } })
      .select('masterProductId')
      .lean();
    const alreadySet = new Set(already.map((l) => String(l.masterProductId)));

    const availability = this.normalizeAvailability(body.defaults?.availability) ?? 'AVAILABLE';
    const defaultStock = Math.max(0, Math.round(Number(body.defaults?.stock) || 0));
    const priceOverride = new Map(
      (body.items || []).map((i) => [i.masterProductId, i.sellingPricePaise]),
    );
    const stockOverride = new Map(
      (body.items || []).map((i) => [i.masterProductId, i.stock]),
    );

    const now = new Date();
    const docs = ids
      .filter((id) => masterById.has(id) && !alreadySet.has(id))
      .map((id) => {
        const masterPrice = masterById.get(id)!.sellingPricePaise;
        const override = priceOverride.get(id);
        const inputPrice = override != null && override >= 0 ? Math.round(override) : masterPrice;
        const isPriceChanged = inputPrice !== masterPrice;
        const itemStock = stockOverride.get(id);
        const stock = itemStock != null ? Math.max(0, Math.round(itemStock)) : defaultStock;
        return {
          sellerId,
          masterProductId: id,
          sellingPricePaise: masterPrice,
          pendingSellingPricePaise: isPriceChanged ? inputPrice : undefined,
          availability: stock > 0 ? availability : 'OUT_OF_STOCK',
          stock,
          reserved: 0,
          status: 'ACTIVE' as const,
          reviewStatus: isPriceChanged ? ('UNDER_REVIEW' as const) : ('APPROVED' as const),
          reviewSubmittedAt: isPriceChanged ? now : undefined,
        };
      });

    if (docs.length) {
      const inserted = await SellerListing.insertMany(docs, { ordered: false });
      const inventoryDocs = inserted.map((l) => ({
        sellerId: l.sellerId,
        listingId: l._id,
        masterProductId: l.masterProductId,
        stock: l.stock,
        reserved: 0,
      }));
      await ShopInventory.insertMany(inventoryDocs, { ordered: false });
    }

    const skipped = ids.length - docs.length;
    return { added: docs.length, skipped, requested: ids.length };
  }

  /** Update the seller's own listing (price / unit / description / notes / attributes / productInformation / availability / stock / on-off). */
  static async updateListing(
    sellerId: string,
    listingId: string,
    patch: {
      sellingPricePaise?: number;
      unit?: string;
      availability?: string;
      enabled?: boolean;
      stock?: number;
      description?: string;
      notes?: string;
      attributes?: Array<{ attributeId: string; value: any }>;
      productInformation?: Record<string, any>;
    },
  ): Promise<SellerListingItemDTO> {
    const listing = await SellerListing.findById(listingId);
    if (!listing) throw new AppError('Listing not found', 404);
    if (String(listing.sellerId) !== sellerId) throw new AppError('Not your listing', 403);

    const master = await MasterProduct.findById(listing.masterProductId).lean();
    if (!master) throw new AppError('Master product not found', 404);

    const wasOutOfStock = listing.availability === 'OUT_OF_STOCK';

    let contentOrPriceChanged = false;

    if (patch.sellingPricePaise != null) {
      if (patch.sellingPricePaise < 0) throw new AppError('Price must be >= 0', 400);
      const newPricePaise = Math.round(patch.sellingPricePaise);

      if (newPricePaise !== listing.sellingPricePaise) {
        listing.pendingSellingPricePaise = newPricePaise;
      } else {
        listing.pendingSellingPricePaise = null;
      }
    }

    if (patch.unit != null) {
      const trimmedUnit = patch.unit.trim();
      const currentUnit = listing.unit ?? '';
      if (trimmedUnit && trimmedUnit !== currentUnit) {
        listing.pendingUnit = trimmedUnit;
      } else {
        listing.pendingUnit = null;
      }
    }

    if (patch.description !== undefined) {
      const trimmedDesc = patch.description.trim();
      const currentDesc = listing.customDescription ?? master.description ?? '';
      if (trimmedDesc !== currentDesc) {
        listing.pendingDescription = trimmedDesc;
      } else {
        listing.pendingDescription = null;
      }
    }

    if (patch.notes !== undefined) {
      const trimmedNotes = patch.notes.trim();
      const currentNotes = listing.customNotes ?? '';
      if (trimmedNotes !== currentNotes) {
        listing.pendingNotes = trimmedNotes;
      } else {
        listing.pendingNotes = null;
      }
    }

    if (patch.attributes !== undefined) {
      const currentAttrs = listing.customAttributes ?? (master.attributes ? master.attributes.map((a: any) => ({ attributeId: a.label, label: a.label, value: a.value })) : []);
      const pendingAttrs = computePendingAttributes(patch.attributes, currentAttrs);
      listing.pendingAttributes = pendingAttrs as any;
    }

    if (patch.productInformation !== undefined) {
      const currentInfo = listing.customProductInformation ?? master.productInformation ?? {};
      const pendingInfo = computePendingProductInformation(patch.productInformation || {}, currentInfo);
      listing.pendingProductInformation = pendingInfo as any;
    }

    const hasAnyPending =
      listing.pendingSellingPricePaise != null ||
      listing.pendingUnit != null ||
      listing.pendingDescription != null ||
      listing.pendingNotes != null ||
      (listing.pendingAttributes != null && Array.isArray(listing.pendingAttributes) && listing.pendingAttributes.length > 0) ||
      (listing.pendingProductInformation != null && Object.keys(listing.pendingProductInformation).length > 0);

    if (hasAnyPending) {
      listing.reviewStatus = 'UNDER_REVIEW';
      listing.reviewSubmittedAt = new Date();
      listing.rejectionReason = null;
    } else {
      listing.pendingSellingPricePaise = null;
      listing.pendingUnit = null;
      listing.pendingDescription = null;
      listing.pendingNotes = null;
      listing.pendingAttributes = null;
      listing.pendingProductInformation = null;
      if (listing.reviewStatus === 'UNDER_REVIEW') {
        listing.reviewStatus = 'APPROVED';
      }
    }

    // Physical stock updates immediately and does NOT require review
    if (patch.stock != null) {
      listing.stock = Math.max(0, Math.round(Number(patch.stock) || 0));
    }

    const available = Math.max(0, listing.stock - (listing.reserved || 0));
    const avail = this.normalizeAvailability(patch.availability);
    if (available <= 0) {
      listing.availability = 'OUT_OF_STOCK';
    } else if (avail && avail !== 'OUT_OF_STOCK') {
      listing.availability = avail;
    } else if (listing.availability === 'OUT_OF_STOCK') {
      listing.availability = 'AVAILABLE';
    }

    if (typeof patch.enabled === 'boolean') listing.status = patch.enabled ? 'ACTIVE' : 'INACTIVE';

    await listing.save();

    if (!wasOutOfStock && listing.availability === 'OUT_OF_STOCK') {
      void this.notifyListingOutOfStock(sellerId, listing.masterProductId, String(listing._id));
    }

    await ShopInventory.findOneAndUpdate(
      { sellerId: listing.sellerId, listingId: listing._id },
      {
        sellerId: listing.sellerId,
        listingId: listing._id,
        masterProductId: listing.masterProductId,
        stock: listing.stock,
        reserved: listing.reserved || 0,
      },
      { upsert: true, new: true },
    );

    const all = await this.listMyListings(sellerId, { limit: 1000 });
    return all.items.find((i) => i.id === listingId)!;
  }

  /** Approve a seller's listing / price / content change (Admin action). */
  static async approveListing(listingId: string): Promise<SellerListingItemDTO> {
    const listing = await SellerListing.findById(listingId);
    if (!listing) throw new AppError('Listing not found', 404);

    const reqPrice = listing.pendingSellingPricePaise;
    const reqUnit = listing.pendingUnit;

    if (listing.pendingSellingPricePaise != null) {
      listing.sellingPricePaise = listing.pendingSellingPricePaise;
      listing.pendingSellingPricePaise = null;
    }
    if (listing.pendingUnit) {
      listing.unit = listing.pendingUnit;
      listing.pendingUnit = null;
    }
    if (listing.pendingDescription != null) {
      listing.customDescription = listing.pendingDescription;
      listing.pendingDescription = null;
    }
    if (listing.pendingNotes != null) {
      listing.customNotes = listing.pendingNotes;
      listing.pendingNotes = null;
    }
    if (listing.pendingAttributes != null) {
      listing.customAttributes = listing.pendingAttributes;
      listing.pendingAttributes = null;
    }
    if (listing.pendingProductInformation != null) {
      listing.customProductInformation = listing.pendingProductInformation;
      listing.pendingProductInformation = null;
    }
    listing.reviewStatus = 'APPROVED';
    listing.rejectionReason = null;
    listing.reviewedAt = new Date();

    await listing.save();

    try {
      await PriceReviewLog.create({
        sellerListingId: listing._id,
        sellerId: listing.sellerId,
        masterProductId: listing.masterProductId,
        requestedPricePaise: reqPrice,
        requestedUnit: reqUnit,
        previousPricePaise: listing.sellingPricePaise,
        previousUnit: listing.unit,
        status: 'APPROVED',
        reviewedAt: new Date(),
      });
    } catch (e) {
      logger.warn('Failed to record PriceReviewLog for approval:', e);
    }

    const all = await this.listMyListings(String(listing.sellerId), { limit: 1000 });
    return all.items.find((i) => i.id === listingId)!;
  }

  /** Reject a seller's pending price/unit/content change (Admin action). */
  static async rejectListing(listingId: string, rejectionReason?: string): Promise<SellerListingItemDTO> {
    const listing = await SellerListing.findById(listingId);
    if (!listing) throw new AppError('Listing not found', 404);

    const reqPrice = listing.pendingSellingPricePaise;
    const reqUnit = listing.pendingUnit;
    const reasonText = rejectionReason?.trim() || 'Request rejected by admin';

    listing.rejectionReason = reasonText;
    listing.reviewStatus = 'REJECTED';
    listing.reviewedAt = new Date();
    listing.pendingSellingPricePaise = null;
    listing.pendingUnit = null;
    listing.pendingDescription = null;
    listing.pendingNotes = null;
    listing.pendingAttributes = null;
    listing.pendingProductInformation = null;

    await listing.save();

    try {
      await PriceReviewLog.create({
        sellerListingId: listing._id,
        sellerId: listing.sellerId,
        masterProductId: listing.masterProductId,
        requestedPricePaise: reqPrice,
        requestedUnit: reqUnit,
        previousPricePaise: listing.sellingPricePaise,
        previousUnit: listing.unit,
        status: 'REJECTED',
        rejectionReason: reasonText,
        reviewedAt: new Date(),
      });
    } catch (e) {
      logger.warn('Failed to record PriceReviewLog for rejection:', e);
    }

    listing.pendingSellingPricePaise = null;
    listing.pendingUnit = null;
    await listing.save();

    const all = await this.listMyListings(String(listing.sellerId), { limit: 1000 });
    return all.items.find((i) => i.id === listingId)!;
  }

  /** Best-effort "your product just went out of stock" ping to the seller. */
  private static async notifyListingOutOfStock(
    sellerId: string,
    masterProductId: Types.ObjectId | string,
    listingId: string,
  ): Promise<void> {
    try {
      const [seller, product] = await Promise.all([
        Seller.findById(sellerId).select('userId fcmTokens').lean(),
        MasterProduct.findById(masterProductId).select('name').lean(),
      ]);
      if (!seller?.userId) return;
      await notifySellerOutOfStock({
        sellerUserId: seller.userId,
        sellerId: String(sellerId),
        fcmTokens: seller.fcmTokens ?? [],
        products: [{ name: product?.name || 'A product', listingId }],
      });
    } catch (err) {
      logger.warn('notifyListingOutOfStock failed (non-fatal)', { err, sellerId, listingId });
    }
  }

  /**
   * Remove a product from the seller's store completely (hard delete). The
   * product stays in the Master Catalogue — the seller can add it again later.
   */
  static async deleteListing(sellerId: string, listingId: string): Promise<{ deleted: true }> {
    const listing = await SellerListing.findById(listingId).select('sellerId');
    if (!listing) throw new AppError('Listing not found', 404);
    if (String(listing.sellerId) !== sellerId) throw new AppError('Not your listing', 403);
    await SellerListing.deleteOne({ _id: listingId });
    await ShopInventory.deleteOne({ listingId });
    return { deleted: true };
  }

  /** Bulk hard-delete across the seller's own listings. Ids that aren't the
   *  seller's (or don't exist) are silently ignored. */
  static async deleteListingsBulk(sellerId: string, body: { ids: string[] }) {
    const ids = [...new Set(body.ids || [])];
    if (!ids.length) throw new AppError('No ids provided', 400);

    const result = await SellerListing.deleteMany({ _id: { $in: ids }, sellerId });
    await ShopInventory.deleteMany({ listingId: { $in: ids }, sellerId });
    return { deleted: result.deletedCount ?? 0, requested: ids.length };
  }

  /** Bulk availability / on-off change across the seller's own listings. */
  static async updateListingsBulk(
    sellerId: string,
    body: { ids: string[]; patch: { availability?: string; enabled?: boolean } },
  ) {
    const ids = [...new Set(body.ids || [])];
    if (!ids.length) throw new AppError('No ids provided', 400);

    const set: Record<string, unknown> = {};
    const avail = this.normalizeAvailability(body.patch?.availability);
    if (avail) set.availability = avail;
    if (typeof body.patch?.enabled === 'boolean') {
      set.status = body.patch.enabled ? 'ACTIVE' : 'INACTIVE';
    }
    if (!Object.keys(set).length) throw new AppError('Nothing to update', 400);

    const result = await SellerListing.updateMany({ _id: { $in: ids }, sellerId }, { $set: set });
    return { matched: result.matchedCount, modified: result.modifiedCount };
  }
}

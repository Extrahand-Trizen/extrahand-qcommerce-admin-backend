import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import MasterProduct from '../models/MasterProduct';
import ProductImage from '../models/ProductImage';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerListing from '../models/SellerListing';
import Promotion from '../models/Promotion';
import Attribute from '../models/Attribute';
import { env } from '../config/env';
import { AppError } from '../utils/response';
import { FilterQuery, Types } from 'mongoose';
import { resolvePublicAssetUrl } from '../utils/media';
import { mapStorefrontProductInformation } from '../utils/productInformation';
import { ProductInformation, PromotionType } from '../types';
import { discountForAmount } from '../utils/promotionMath';

export type StoreProduct = {
  id: string;
  name: string;
  unit: string;
  price: number;
  mrp?: number;
  imageUrl: string;
  brand?: string;
  description?: string;
  subcategorySlug?: string;
  categorySlug?: string;
  inStock: boolean;
  purchasable: boolean;
  /** % off vs `mrp` when an automatic seller offer is live on this product. */
  discountPercent?: number;
  /** ISO end of the automatic offer, so the app can show "ends in 3h". */
  offerEndsAt?: string;
};

type AutoOfferInfo = {
  promotionId: string;
  type: PromotionType;
  value: number;
  maxDiscountPaise?: number;
  endsAt: Date;
};

type SellerListingInfo = {
  price: number;
  mrp?: number;
  inStock: boolean;
  purchasable: boolean;
};

export type StorefrontQuery = {
  sellerId?: string;
};

export type StoreCategoryGroup = {
  id: string;
  title: string;
  imageUrl: string;
  subcategories: Array<{
    id: string;
    label: string;
    imageUrl: string;
  }>;
};

export type StoreHomePayload = {
  /** Which store this storefront is showing — the client MUST echo `store.sellerId`
   *  back as `?sellerId=` on cart + checkout so the order is pinned correctly. */
  store: { sellerId: string; shopName: string; shopCity?: string } | null;
  categories: Array<{ id: string; label: string; imageUrl: string }>;
  bestsellers: StoreProduct[];
  freshPicks: StoreProduct[];
  popular: StoreProduct[];
  recommended: StoreProduct[];
};

export type StoreProductDetailPayload = {
  product: StoreProduct;
  gallery: string[];
  highlights: Array<{ label: string; value: string }>;
  information: Array<{ label: string; value: string }>;
  productInformation?: ProductInformation;
  related: StoreProduct[];
  similar: StoreProduct[];
};

export type StoreProductTypeRail = {
  id: string;
  label: string;
  imageUrl: string;
};

async function buildAttributeKeyMap() {
  const attrs = await Attribute.find({ isActive: true }).select('_id key');
  return new Map(attrs.map((a) => [a._id.toString(), a.key]));
}

function readAttributeValue(
  attributes: Array<{ attributeId: Types.ObjectId | string; value: unknown }>,
  keyMap: Map<string, string>,
  key: string,
): string | undefined {
  for (const attr of attributes) {
    if (keyMap.get(attr.attributeId.toString()) === key) {
      const value = attr.value;
      if (value === null || value === undefined) return undefined;
      return String(value);
    }
  }
  return undefined;
}

function resolveProductUnit(
  attributes: Array<{ attributeId: Types.ObjectId | string; value: unknown }>,
  keyMap: Map<string, string>,
): string {
  const netQuantity = readAttributeValue(attributes, keyMap, 'net_quantity');
  const unit = readAttributeValue(attributes, keyMap, 'unit');
  if (netQuantity && unit) return `${netQuantity} ${unit}`;

  const legacyWeight = readAttributeValue(attributes, keyMap, 'weight');
  if (legacyWeight) return legacyWeight;

  return readAttributeValue(attributes, keyMap, 'sold_as') || '1 pc';
}

const SEED_STOREFRONT_SELLER_USER_ID = 'seed-default-seller';

let cachedSeedSellerObjectId: Types.ObjectId | null | undefined;

async function getSeedSellerObjectId(): Promise<Types.ObjectId | null> {
  if (cachedSeedSellerObjectId !== undefined) return cachedSeedSellerObjectId;
  const seedSeller = await Seller.findOne({ userId: SEED_STOREFRONT_SELLER_USER_ID })
    .select('_id')
    .lean();
  cachedSeedSellerObjectId = seedSeller?._id ?? null;
  return cachedSeedSellerObjectId;
}

const STOREFRONT_LISTING_MATCH = {
  status: 'ACTIVE',
  reviewStatus: 'APPROVED',
} as const;

async function resolveStorefrontSellerId(sellerId?: string): Promise<Types.ObjectId | null> {
  const requested = sellerId?.trim() || env.DEFAULT_STOREFRONT_SELLER_ID?.trim();
  if (requested) {
    if (!Types.ObjectId.isValid(requested)) return null;
    return new Types.ObjectId(requested);
  }

  // Never auto-select the demo seed dark store for live customer storefront.
  const listingRows = await SellerListing.aggregate<{ _id: Types.ObjectId; listingCount: number }>([
    { $match: { status: 'ACTIVE', reviewStatus: 'APPROVED' } },
    { $group: { _id: '$sellerId', listingCount: { $sum: 1 } } },
    { $sort: { listingCount: -1 } },
  ]);

  for (const row of listingRows) {
    const seller = await Seller.findOne({
      _id: row._id,
      status: 'ACTIVE',
      userId: { $ne: SEED_STOREFRONT_SELLER_USER_ID },
    })
      .select('_id')
      .lean();
    if (seller) return seller._id;
  }

  const fallback = await Seller.findOne({
    status: 'ACTIVE',
    userId: { $ne: SEED_STOREFRONT_SELLER_USER_ID },
  })
    .select('_id')
    .lean();

  return fallback?._id ?? null;
}

function listingInfoFromRow(listing: {
  sellingPricePaise: number;
  compareAtPricePaise?: number | null;
  availability: string;
}): SellerListingInfo {
  const inStock = listing.availability === 'AVAILABLE' || listing.availability === 'LIMITED';
  return {
    price: listing.sellingPricePaise / 100,
    mrp: listing.compareAtPricePaise != null ? listing.compareAtPricePaise / 100 : undefined,
    inStock,
    purchasable: inStock,
  };
}


async function loadSellerListingMap(
  productIds: Types.ObjectId[],
  sellerObjectId: Types.ObjectId | null,
) {
  if (!productIds.length || !sellerObjectId) return new Map<string, SellerListingInfo>();

  const listings = await SellerListing.find({
    sellerId: sellerObjectId,
    masterProductId: { $in: productIds },
    ...STOREFRONT_LISTING_MATCH,
  }).lean();

  const listingMap = new Map<string, SellerListingInfo>();
  for (const listing of listings) {
    listingMap.set(listing.masterProductId.toString(), listingInfoFromRow(listing));
  }
  return listingMap;
}

/** Best listing per product across real sellers — prefer in-stock, then lowest price. */
async function loadAnySellerListingMap(productIds: Types.ObjectId[]) {
  if (!productIds.length) return new Map<string, SellerListingInfo>();

  const seedSellerId = await getSeedSellerObjectId();
  const listingFilter: FilterQuery<typeof SellerListing> = {
    masterProductId: { $in: productIds },
    ...STOREFRONT_LISTING_MATCH,
  };
  if (seedSellerId) {
    listingFilter.sellerId = { $ne: seedSellerId };
  }

  const listings = await SellerListing.find(listingFilter).lean();

  const listingMap = new Map<string, SellerListingInfo>();
  for (const listing of listings) {
    const key = listing.masterProductId.toString();
    const info = listingInfoFromRow(listing);
    const existing = listingMap.get(key);
    if (!existing) {
      listingMap.set(key, info);
      continue;
    }
    if (info.inStock && !existing.inStock) {
      listingMap.set(key, info);
    } else if (info.inStock === existing.inStock && info.price < existing.price) {
      listingMap.set(key, info);
    } else if (!existing.inStock && !info.inStock && info.price < existing.price) {
      listingMap.set(key, info);
    }
  }
  return listingMap;
}

async function loadListedMasterProductIds(): Promise<Types.ObjectId[]> {
  return SellerListing.distinct('masterProductId', STOREFRONT_LISTING_MATCH);
}

/** Active AUTOMATIC product offers for this seller, keyed by masterProductId. */
async function loadAutoOfferMap(
  productIds: Types.ObjectId[],
  sellerObjectId: Types.ObjectId | null,
): Promise<Map<string, AutoOfferInfo>> {
  if (!productIds.length || !sellerObjectId) return new Map();

  const now = new Date();
  const promos = await Promotion.find({
    sellerId: sellerObjectId,
    trigger: 'AUTOMATIC',
    state: 'ACTIVE',
    startsAt: { $lte: now },
    endsAt: { $gte: now },
    productMasterIds: { $in: productIds },
  })
    .select('type value maxDiscountPaise endsAt productMasterIds')
    .lean();

  const map = new Map<string, AutoOfferInfo>();
  for (const promo of promos) {
    const info: AutoOfferInfo = {
      promotionId: promo._id.toString(),
      type: promo.type,
      value: promo.value,
      maxDiscountPaise: promo.maxDiscountPaise,
      endsAt: promo.endsAt,
    };
    for (const pid of promo.productMasterIds ?? []) {
      // Overlap is blocked on write; if two ever collide, keep the first.
      const key = pid.toString();
      if (!map.has(key)) map.set(key, info);
    }
  }
  return map;
}

function resolveStoreProductAvailability(
  productId: string,
  referencePrice: number,
  preferredSellerListingMap: Map<string, SellerListingInfo>,
  anySellerListingMap: Map<string, SellerListingInfo>,
  autoOffer?: AutoOfferInfo,
) {
  const preferredListing = preferredSellerListingMap.get(productId);
  const anyListing = anySellerListingMap.get(productId);
  const inStock = Boolean(anyListing?.inStock);

  let price = referencePrice;
  let mrp: number | undefined;

  if (preferredListing?.inStock) {
    price = preferredListing.price;
    mrp = preferredListing.mrp;
  } else if (anyListing?.inStock) {
    price = anyListing.price;
    mrp = anyListing.mrp;
  } else if (preferredListing) {
    price = preferredListing.price;
    mrp = preferredListing.mrp;
  } else if (anyListing) {
    price = anyListing.price;
    mrp = anyListing.mrp;
  }

  let discountPercent: number | undefined;
  let offerEndsAt: string | undefined;

  if (autoOffer) {
    const listPricePaise = Math.round(price * 100);
    const discPaise = discountForAmount(autoOffer, listPricePaise);
    if (discPaise > 0) {
      const dealPricePaise = listPricePaise - discPaise;
      // struck-through price = the higher of the current MRP and the list price
      const mrpPaise = Math.max(Math.round((mrp ?? 0) * 100), listPricePaise);
      price = dealPricePaise / 100;
      mrp = mrpPaise / 100;
      discountPercent = Math.round(((mrpPaise - dealPricePaise) / mrpPaise) * 100);
      offerEndsAt = autoOffer.endsAt.toISOString();
    }
  }

  return {
    price,
    mrp,
    inStock,
    purchasable: inStock,
    discountPercent,
    offerEndsAt,
  };
}

async function mapProductsToStore(
  products: Array<{
    _id: Types.ObjectId;
    name: string;
    slug: string;
    brand?: string;
    description?: string;
    sellingPricePaise?: number;
    attributes: Array<{ attributeId: Types.ObjectId | string; value: unknown }>;
    subcategoryId?: { slug?: string } | Types.ObjectId;
    categoryId?: { slug?: string } | Types.ObjectId;
  }>,
  imageMap: Map<string, string>,
  preferredSellerListingMap: Map<string, SellerListingInfo>,
  anySellerListingMap: Map<string, SellerListingInfo>,
  keyMap: Map<string, string>,
  autoOfferMap: Map<string, AutoOfferInfo> = new Map(),
): Promise<StoreProduct[]> {
  return products.map((product) => {
      const id = product._id.toString();
      const imageUrl = imageMap.get(id) || '';

      const referencePrice = (product.sellingPricePaise ?? 0) / 100;
      const availability = resolveStoreProductAvailability(
        id,
        referencePrice,
        preferredSellerListingMap,
        anySellerListingMap,
        autoOfferMap.get(id),
      );

      const subcategory =
        product.subcategoryId && typeof product.subcategoryId === 'object' && 'slug' in product.subcategoryId
          ? product.subcategoryId.slug
          : undefined;
      const category =
        product.categoryId && typeof product.categoryId === 'object' && 'slug' in product.categoryId
          ? product.categoryId.slug
          : undefined;

      const unit = resolveProductUnit(
        product.attributes as Array<{ attributeId: Types.ObjectId | string; value: unknown }>,
        keyMap,
      );

      return {
        id: product.slug,
        name: product.name,
        unit,
        price: availability.price,
        mrp: availability.mrp,
        imageUrl: imageUrl ? resolvePublicAssetUrl(imageUrl) : '',
        brand: product.brand,
        description: product.description,
        subcategorySlug: subcategory,
        categorySlug: category,
        inStock: availability.inStock,
        purchasable: availability.purchasable,
        discountPercent: availability.discountPercent,
        offerEndsAt: availability.offerEndsAt,
      };
    });
}

async function loadProductImages(productIds: Types.ObjectId[]) {
  if (!productIds.length) return new Map<string, string>();

  const allImages = await ProductImage.find({
    masterProductId: { $in: productIds },
  }).sort({ isPrimary: -1, displayOrder: 1 });

  const imageMap = new Map<string, string>();
  for (const img of allImages) {
    const key = img.masterProductId.toString();
    if (!imageMap.has(key)) {
      imageMap.set(key, resolvePublicAssetUrl(img.imageUrl));
    }
  }
  return imageMap;
}

type RelatedMasterProduct = {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  brand?: string;
  description?: string;
  sellingPricePaise?: number;
  attributes: Array<{ attributeId: Types.ObjectId | string; value: unknown }>;
  subcategoryId?: { slug?: string } | Types.ObjectId;
  categoryId?: { slug?: string } | Types.ObjectId;
};

function resolveRefId(
  ref?: { _id?: Types.ObjectId } | Types.ObjectId | null,
): Types.ObjectId | undefined {
  if (!ref) return undefined;
  if (typeof ref === 'object' && '_id' in ref && ref._id) return ref._id;
  return ref as Types.ObjectId;
}

/** Related picks: same subcategory → same category → catalog (for sparse seller-submitted types). */
async function loadRelatedMasterProducts(
  product: {
    _id: Types.ObjectId;
    subcategoryId?: { _id?: Types.ObjectId; slug?: string } | Types.ObjectId;
    categoryId?: { _id?: Types.ObjectId; slug?: string } | Types.ObjectId;
  },
  candidateLimit = 24,
): Promise<RelatedMasterProduct[]> {
  const excludeId = product._id;
  const subcategoryId = resolveRefId(product.subcategoryId);
  const categoryId = resolveRefId(product.categoryId);
  const collected: RelatedMasterProduct[] = [];
  const seen = new Set<string>([excludeId.toString()]);

  const append = (rows: RelatedMasterProduct[]) => {
    for (const row of rows) {
      const id = row._id.toString();
      if (seen.has(id)) continue;
      seen.add(id);
      collected.push(row);
      if (collected.length >= candidateLimit) break;
    }
  };

  const baseFilter: FilterQuery<typeof MasterProduct> = {
    status: 'ACTIVE',
    _id: { $ne: excludeId },
  };

  if (subcategoryId) {
    const rows = await MasterProduct.find({ ...baseFilter, subcategoryId })
      .populate('subcategoryId', 'slug')
      .populate('categoryId', 'slug')
      .sort({ createdAt: -1 })
      .limit(candidateLimit)
      .lean();
    append(rows as RelatedMasterProduct[]);
  }

  if (collected.length < candidateLimit && categoryId) {
    const rows = await MasterProduct.find({ ...baseFilter, categoryId })
      .populate('subcategoryId', 'slug')
      .populate('categoryId', 'slug')
      .sort({ createdAt: -1 })
      .limit(candidateLimit)
      .lean();
    append(rows as RelatedMasterProduct[]);
  }

  if (collected.length < candidateLimit) {
    const rows = await MasterProduct.find(baseFilter)
      .populate('subcategoryId', 'slug')
      .populate('categoryId', 'slug')
      .sort({ createdAt: -1 })
      .limit(candidateLimit)
      .lean();
    append(rows as RelatedMasterProduct[]);
  }

  return collected;
}

export class StorefrontService {
  static async getCategoryGroups(): Promise<StoreCategoryGroup[]> {
    const categories = await Category.find({ status: 'ACTIVE' }).sort({ displayOrder: 1 });
    const subcategories = await Subcategory.find({ status: 'ACTIVE' }).sort({ displayOrder: 1 });

    const subsByCategory = new Map<string, typeof subcategories>();
    for (const sub of subcategories) {
      const key = sub.categoryId.toString();
      const list = subsByCategory.get(key) || [];
      list.push(sub);
      subsByCategory.set(key, list);
    }

    return categories.map((cat) => ({
      id: cat.slug,
      title: cat.name,
      imageUrl: resolvePublicAssetUrl(cat.imageUrl || ''),
      subcategories: (subsByCategory.get(cat._id.toString()) || []).map((sub) => ({
        id: sub.slug,
        label: sub.name,
        imageUrl: resolvePublicAssetUrl(sub.imageUrl || ''),
      })),
    }));
  }

  static async listProducts(query: {
    page?: number;
    limit?: number;
    search?: string;
    categorySlug?: string;
    subcategorySlug?: string;
    productTypeSlug?: string;
    sellerId?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const filter: FilterQuery<typeof MasterProduct> = { status: 'ACTIVE' };
    const sellerObjectId = await resolveStorefrontSellerId(query.sellerId);

    if (query.search?.trim()) {
      filter.$or = [
        { name: { $regex: query.search.trim(), $options: 'i' } },
        { brand: { $regex: query.search.trim(), $options: 'i' } },
      ];
    }

    if (query.subcategorySlug) {
      const sub = await Subcategory.findOne({ slug: query.subcategorySlug, status: 'ACTIVE' });
      if (!sub) return { items: [] as StoreProduct[], total: 0, page, limit, totalPages: 0 };
      filter.subcategoryId = sub._id;
    } else if (query.categorySlug) {
      const cat = await Category.findOne({ slug: query.categorySlug, status: 'ACTIVE' });
      if (!cat) return { items: [] as StoreProduct[], total: 0, page, limit, totalPages: 0 };
      filter.categoryId = cat._id;
    }

    if (query.productTypeSlug?.trim()) {
      const productType = await ProductType.findOne({
        slug: query.productTypeSlug.trim(),
        status: 'ACTIVE',
      });
      if (!productType) {
        return { items: [] as StoreProduct[], total: 0, page, limit, totalPages: 0 };
      }
      filter.productTypeId = productType._id;
    }

    const listedProductIds = await loadListedMasterProductIds();
    if (!listedProductIds.length) {
      return { items: [] as StoreProduct[], total: 0, page, limit, totalPages: 0 };
    }
    filter._id = { $in: listedProductIds };

    const total = await MasterProduct.countDocuments(filter);
    const products = await MasterProduct.find(filter)
      .populate('subcategoryId', 'slug')
      .populate('categoryId', 'slug')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const productIds = products.map((p) => p._id);
    const [imageMap, preferredSellerListingMap, anySellerListingMap, keyMap, autoOfferMap] =
      await Promise.all([
        loadProductImages(productIds),
        loadSellerListingMap(productIds, sellerObjectId),
        loadAnySellerListingMap(productIds),
        buildAttributeKeyMap(),
        loadAutoOfferMap(productIds, sellerObjectId),
      ]);

    const items = await mapProductsToStore(
      products,
      imageMap,
      preferredSellerListingMap,
      anySellerListingMap,
      keyMap,
      autoOfferMap,
    );
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  static async getProductBySlug(slug: string, query: StorefrontQuery = {}): Promise<StoreProductDetailPayload> {
    const product = await MasterProduct.findOne({ slug, status: 'ACTIVE' })
      .populate('subcategoryId', 'slug name')
      .populate('categoryId', 'slug name');

    if (!product) throw new AppError('Product not found', 404);

    const images = await ProductImage.find({ masterProductId: product._id }).sort({ displayOrder: 1 });
    const sellerObjectId = await resolveStorefrontSellerId(query.sellerId);
    const [preferredSellerListingMap, anySellerListingMap, keyMap, autoOfferMap] = await Promise.all([
      loadSellerListingMap([product._id], sellerObjectId),
      loadAnySellerListingMap([product._id]),
      buildAttributeKeyMap(),
      loadAutoOfferMap([product._id], sellerObjectId),
    ]);
    const referencePrice = (product.sellingPricePaise ?? 0) / 100;
    const availability = resolveStoreProductAvailability(
      product._id.toString(),
      referencePrice,
      preferredSellerListingMap,
      anySellerListingMap,
      autoOfferMap.get(product._id.toString()),
    );

    const primaryImage = images.find((img) => img.isPrimary) || images[0];
    const unit = resolveProductUnit(product.attributes, keyMap);

    const storeProduct: StoreProduct = {
      id: product.slug,
      name: product.name,
      unit,
      price: availability.price,
      mrp: availability.mrp,
      imageUrl: resolvePublicAssetUrl(primaryImage?.imageUrl || ''),
      brand: product.brand,
      description: product.description,
      subcategorySlug:
        product.subcategoryId && typeof product.subcategoryId === 'object' && 'slug' in product.subcategoryId
          ? String(product.subcategoryId.slug)
          : undefined,
      categorySlug:
        product.categoryId && typeof product.categoryId === 'object' && 'slug' in product.categoryId
          ? String(product.categoryId.slug)
          : undefined,
      inStock: availability.inStock,
      purchasable: availability.purchasable,
      discountPercent: availability.discountPercent,
      offerEndsAt: availability.offerEndsAt,
    };

    const relatedCandidates = await loadRelatedMasterProducts(product, 24);
    const relatedIds = relatedCandidates.map((p) => p._id);
    const [relatedImageMap, relatedPreferredListingMap, relatedAnyListingMap, relatedAutoOfferMap] =
      await Promise.all([
        loadProductImages(relatedIds),
        loadSellerListingMap(relatedIds, sellerObjectId),
        loadAnySellerListingMap(relatedIds),
        loadAutoOfferMap(relatedIds, sellerObjectId),
      ]);
    const related = (
      await mapProductsToStore(
        relatedCandidates,
        relatedImageMap,
        relatedPreferredListingMap,
        relatedAnyListingMap,
        keyMap,
        relatedAutoOfferMap,
      )
    ).slice(0, 8);

    const productInformation = mapStorefrontProductInformation(product.productInformation);

    return {
      product: storeProduct,
      gallery: images.map((img) => resolvePublicAssetUrl(img.imageUrl)),
      highlights: [
        { label: 'Brand', value: product.brand || '—' },
        { label: 'Unit', value: unit },
        {
          label: 'Organic',
          value: readAttributeValue(product.attributes, keyMap, 'organic') === 'true' ? 'Yes' : 'No',
        },
      ],
      information: product.description
        ? [{ label: 'Description', value: product.description }]
        : [],
      ...(productInformation ? { productInformation } : {}),
      related,
      similar: related.slice(0, 4),
    };
  }

  static async getHome(query: StorefrontQuery = {}) {
    const [groups, keyMap, sellerObjectId] = await Promise.all([
      this.getCategoryGroups(),
      buildAttributeKeyMap(),
      resolveStorefrontSellerId(query.sellerId),
    ]);

    const categories = groups.slice(0, 8).map((group) => ({
      id: group.id,
      label: group.title,
      imageUrl: resolvePublicAssetUrl(group.imageUrl),
    }));

    const listedProductIds = await loadListedMasterProductIds();

    const loadSection = async (filter: FilterQuery<typeof MasterProduct>, limit = 10) => {
      const products = await MasterProduct.find({
        status: 'ACTIVE',
        _id: { $in: listedProductIds },
        ...filter,
      })
        .populate('subcategoryId', 'slug')
        .populate('categoryId', 'slug')
        .sort({ createdAt: -1 })
        .limit(limit);
      const productIds = products.map((p) => p._id);
      const [imageMap, preferredSellerListingMap, anySellerListingMap, autoOfferMap] =
        await Promise.all([
          loadProductImages(productIds),
          loadSellerListingMap(productIds, sellerObjectId),
          loadAnySellerListingMap(productIds),
          loadAutoOfferMap(productIds, sellerObjectId),
        ]);
      const mapped = await mapProductsToStore(
        products,
        imageMap,
        preferredSellerListingMap,
        anySellerListingMap,
        keyMap,
        autoOfferMap,
      );
      return mapped.sort((a, b) => Number(b.inStock) - Number(a.inStock));
    };

    const fruitsVeg = await Subcategory.findOne({ slug: 'fruits-veg', status: 'ACTIVE' });

    const [bestsellers, freshPicks, popular, recommended, storeSnapshot] = await Promise.all([
      loadSection({}, 10),
      fruitsVeg ? loadSection({ subcategoryId: fruitsVeg._id }, 10) : loadSection({}, 10),
      loadSection({}, 8),
      loadSection({}, 8),
      sellerObjectId
        ? this.resolveSellerStoreSnapshot({ sellerId: sellerObjectId.toString() })
        : Promise.resolve(null),
    ]);

    return {
      store: storeSnapshot
        ? {
            sellerId: storeSnapshot.sellerId.toString(),
            shopName: storeSnapshot.shopName,
            shopCity: storeSnapshot.shopCity,
          }
        : null,
      categories,
      bestsellers,
      freshPicks,
      popular,
      recommended,
    } satisfies StoreHomePayload;
  }

  /** Sidebar rails for a subcategory PLP — active catalogue product types. */
  static async getSubcategoryProductTypes(subcategorySlug: string): Promise<StoreProductTypeRail[]> {
    const sub = await Subcategory.findOne({ slug: subcategorySlug, status: 'ACTIVE' }).lean();
    if (!sub) return [];

    const types = await ProductType.find({ subcategoryId: sub._id, status: 'ACTIVE' })
      .sort({ displayOrder: 1, name: 1 })
      .select('_id name slug')
      .lean();

    if (!types.length) return [];

    const typeIds = types.map((type) => type._id);
    const products = await MasterProduct.find({
      status: 'ACTIVE',
      productTypeId: { $in: typeIds },
    })
      .select('_id productTypeId')
      .lean();

    const productIds = products.map((product) => product._id);
    const images = productIds.length
      ? await ProductImage.find({ masterProductId: { $in: productIds } }).sort({
          isPrimary: -1,
          displayOrder: 1,
        })
      : [];

    const imageByProductId = new Map<string, string>();
    for (const image of images) {
      const key = image.masterProductId.toString();
      if (!imageByProductId.has(key)) {
        imageByProductId.set(key, resolvePublicAssetUrl(image.imageUrl));
      }
    }

    const imageByTypeId = new Map<string, string>();
    for (const product of products) {
      const typeId = product.productTypeId.toString();
      if (imageByTypeId.has(typeId)) continue;
      const imageUrl = imageByProductId.get(product._id.toString());
      if (imageUrl) imageByTypeId.set(typeId, imageUrl);
    }

    const fallbackImage = resolvePublicAssetUrl(sub.imageUrl || '');

    return types.map((type) => ({
      id: type.slug,
      label: type.name,
      imageUrl: imageByTypeId.get(type._id.toString()) || fallbackImage,
    }));
  }

  /** Resolve storefront product cards for cart/wishlist enrichment. */
  static async resolveProductsBySlugs(
    slugs: string[],
    query: StorefrontQuery = {},
  ): Promise<Map<string, StoreProduct>> {
    const uniqueSlugs = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
    if (!uniqueSlugs.length) return new Map();

    const products = await MasterProduct.find({ slug: { $in: uniqueSlugs }, status: 'ACTIVE' })
      .populate('subcategoryId', 'slug')
      .populate('categoryId', 'slug');
    if (!products.length) return new Map();

    const productIds = products.map((product) => product._id);
    const sellerObjectId = await resolveStorefrontSellerId(query.sellerId);
    const [imageMap, preferredSellerListingMap, anySellerListingMap, keyMap, autoOfferMap] =
      await Promise.all([
        loadProductImages(productIds),
        loadSellerListingMap(productIds, sellerObjectId),
        loadAnySellerListingMap(productIds),
        buildAttributeKeyMap(),
        loadAutoOfferMap(productIds, sellerObjectId),
      ]);

    const mapped = await mapProductsToStore(
      products,
      imageMap,
      preferredSellerListingMap,
      anySellerListingMap,
      keyMap,
      autoOfferMap,
    );

    return new Map(mapped.map((product) => [product.id, product]));
  }

  static async resolveSellerStoreSnapshot(query: StorefrontQuery = {}) {
    const sellerObjectId = await resolveStorefrontSellerId(query.sellerId);
    if (!sellerObjectId) return null;

    const [seller, onboarding] = await Promise.all([
      Seller.findById(sellerObjectId).select('userId fullName').lean(),
      SellerOnboarding.findOne({ sellerId: sellerObjectId }).select('shopName city').lean(),
    ]);
    if (!seller) return null;

    return {
      sellerId: sellerObjectId,
      sellerUserId: seller.userId,
      shopName: onboarding?.shopName?.trim() || seller.fullName?.trim() || 'Grocery store',
      shopCity: onboarding?.city?.trim() || undefined,
    };
  }
}

import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import MasterProduct from '../models/MasterProduct';
import ProductImage from '../models/ProductImage';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerStoreSettings from '../models/SellerStoreSettings';
import SellerListing from '../models/SellerListing';
import Promotion from '../models/Promotion';
import { AppError } from '../utils/response';
import { FilterQuery, Types } from 'mongoose';
import { resolvePublicAssetUrl } from '../utils/media';
import { mapStorefrontProductInformation } from '../utils/productInformation';
import { ProductInformation, PromotionType } from '../types';
import { discountForAmount } from '../utils/promotionMath';
import {
  loadAnySellerListingMap,
  loadPreferredSellerListingMap,
  resolveStorefrontSellerForLocation,
  SellerListingInfo,
  storefrontStoreDto,
  StorefrontSellerResolveResult,
} from './storefront/storefrontListingQueries';
import {
  applyStorefrontListFilters,
  attachCategorySlugs,
  buildAttributeKeyMap,
  fetchListedMasterProducts,
  fetchListedMasterProductsPage,
  fetchListedProductFacets,
  loadPrimaryProductImages,
  loadRelatedMasterProducts,
  resolveCategoryFilters,
  STOREFRONT_PRICE_BUCKETS,
  STOREFRONT_PRODUCT_SELECT,
  StorefrontFilterFacets,
  StorefrontMasterProductRow,
} from './storefront/storefrontProductQueries';
import { reopenExpiredPauses } from './SellerFulfillmentHealthService';

type StoreOperationalState = {
  acceptingOrders: boolean;
  unavailableReason?: string;
  pauseUntil?: string;
};

async function resolveStoreOperationalState(
  sellerId: Types.ObjectId,
): Promise<StoreOperationalState> {
  await reopenExpiredPauses({ sellerId }).catch(() => undefined);
  const settings = await SellerStoreSettings.findOne({ sellerId })
    .select('storeStatus autoPausedAt pauseUntil')
    .lean();

  if (settings?.autoPausedAt) {
    return {
      acceptingOrders: false,
      unavailableReason: 'Shop temporarily unavailable',
      ...(settings.pauseUntil
        ? { pauseUntil: settings.pauseUntil.toISOString() }
        : {}),
    };
  }
  if (settings?.storeStatus === 'CLOSED') {
    return {
      acceptingOrders: false,
      unavailableReason: 'Shop currently closed',
    };
  }
  return { acceptingOrders: true };
}

function applyStoreOperationalState(
  product: StoreProduct,
  state: StoreOperationalState,
): StoreProduct {
  return {
    ...product,
    storeAcceptingOrders: state.acceptingOrders,
    ...(state.unavailableReason
      ? { storeUnavailableReason: state.unavailableReason }
      : {}),
    ...(state.pauseUntil ? { storePauseUntil: state.pauseUntil } : {}),
  };
}

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
  productTypeSlug?: string;
  inStock: boolean;
  purchasable: boolean;
  /** False when the selected nearby store does not list this product. */
  availableAtCurrentLocation?: boolean;
  /** False when this store is closed/auto-paused; independent of physical stock. */
  storeAcceptingOrders?: boolean;
  storeUnavailableReason?: string;
  storePauseUntil?: string;
  stock?: number;
  availableQuantity?: number;
  lifespanValue?: number;
  lifespanUnit?: string;
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

export type StorefrontQuery = {
  sellerId?: string;
  lat?: number;
  lng?: number;
  pinCode?: string;
  city?: string;
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
  /** Whether a store currently delivers to the customer's location. */
  serviceable: boolean;
  /** Whether customer location (or explicit sellerId) was used for resolution. */
  locationUsed?: boolean;
  /** Which store this storefront is showing — the client MUST echo `store.sellerId`
   *  back as `?sellerId=` on cart + checkout so the order is pinned correctly. */
  store: {
    sellerId: string;
    shopName: string;
    shopCity?: string;
    distanceKm?: number;
    acceptingOrders?: boolean;
    unavailableReason?: string;
    pauseUntil?: string;
  } | null;
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
  /** Nearby store / seller shown on PDP. Missing fields use "Not available". */
  seller?: {
    name: string;
    address: string;
    license: string;
    gstin: string;
    distanceKm?: number;
  };
};

export type StoreProductTypeRail = {
  id: string;
  label: string;
  imageUrl: string;
};

function populatedSlug(ref?: { slug?: string } | Types.ObjectId): string | undefined {
  if (ref && typeof ref === 'object' && 'slug' in ref && ref.slug) return String(ref.slug);
  return undefined;
}

function populatedName(ref?: { name?: string; slug?: string } | Types.ObjectId): string | undefined {
  if (ref && typeof ref === 'object' && 'name' in ref && ref.name) return String(ref.name).trim();
  return undefined;
}

const NOT_AVAILABLE = 'Not available';

function displayOrUnavailable(value?: string | null): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || NOT_AVAILABLE;
}

function pushDetailRow(
  rows: Array<{ label: string; value: string }>,
  label: string,
  value?: string | null,
  options?: { always?: boolean },
) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    if (options?.always) rows.push({ label, value: NOT_AVAILABLE });
    return;
  }
  rows.push({ label, value: trimmed });
}

function formatSellerAddress(onboarding: {
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

/**
 * Highlights ≈ Blinkit “Highlights / Key information”, driven by catalogue
 * fields + MasterProduct.productInformation (ingredients, servings, nutrients).
 */
function buildPdpHighlights(input: {
  brand?: string;
  unit: string;
  lifespanValue?: number;
  lifespanUnit?: string;
  categoryName?: string;
  subcategoryName?: string;
  productTypeName?: string;
  attributes: Array<{ attributeId: Types.ObjectId | string; value: unknown }>;
  keyMap: Map<string, string>;
  productInformation?: ProductInformation;
}): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const attr = (key: string) => readAttributeValue(input.attributes, input.keyMap, key);
  const info = input.productInformation;
  const nutrition = info?.nutritionInformation;

  const productType =
    input.productTypeName || input.subcategoryName || input.categoryName;
  pushDetailRow(rows, 'Type', productType, { always: true });
  pushDetailRow(rows, 'Size', input.unit, { always: true });
  pushDetailRow(rows, 'Brand', input.brand, { always: true });
  if (input.lifespanValue && input.lifespanUnit) {
    pushDetailRow(
      rows,
      'Lifespan',
      `${input.lifespanValue} ${input.lifespanUnit}`,
    );
  }

  const origin = attr('country_origin') || attr('country_of_origin');
  if (origin) {
    const domestic = /^india$/i.test(origin.trim());
    pushDetailRow(rows, 'Imported', domestic ? 'No' : 'Yes');
  } else {
    pushDetailRow(rows, 'Imported', undefined, { always: true });
  }

  const organic = attr('organic');
  if (organic === 'true' || organic === 'false') {
    pushDetailRow(rows, 'Organic', organic === 'true' ? 'Yes' : 'No');
  }

  pushDetailRow(rows, 'Dietary preference', attr('dietary_preference') || attr('dietary'));
  pushDetailRow(rows, 'Sold as', attr('sold_as'));
  pushDetailRow(rows, 'Variety', attr('variety') || attr('variant'));

  // Product Information — only surface fields that exist on the master product.
  pushDetailRow(rows, 'Ingredients', info?.ingredients || attr('ingredients'));
  pushDetailRow(rows, 'Allergens', info?.allergens);
  pushDetailRow(rows, 'How to use', info?.usageInstructions);
  pushDetailRow(rows, 'Storage tip', info?.storageInformation);

  if (nutrition) {
    pushDetailRow(rows, 'Serving size', nutrition.servingSize);
    pushDetailRow(rows, 'Energy', nutrition.energy);
    pushDetailRow(rows, 'Protein', nutrition.protein);
    pushDetailRow(rows, 'Carbohydrates', nutrition.carbohydrates);
    pushDetailRow(rows, 'Total fat', nutrition.totalFat);
    pushDetailRow(rows, 'Saturated fat', nutrition.saturatedFat);
    pushDetailRow(rows, 'Sugar', nutrition.sugar);
    pushDetailRow(rows, 'Sodium', nutrition.sodium);
  }

  const healthBenefits =
    attr('health_benefits') || attr('key_features') || attr('key_feature');
  pushDetailRow(rows, 'Health benefits', healthBenefits);

  return rows;
}

/**
 * Info ≈ description / unit / shelf life / origin / policies, then seller essentials
 * (name, address, FSSAI, GSTIN). No Sold-by card — seller lives here only.
 */
function buildPdpInformation(input: {
  description?: string;
  unit: string;
  lifespanValue?: number;
  lifespanUnit?: string;
  attributes: Array<{ attributeId: Types.ObjectId | string; value: unknown }>;
  keyMap: Map<string, string>;
  productInformation?: ProductInformation;
  seller: {
    name: string;
    address: string;
    license: string;
    gstin: string;
  };
}): Array<{ label: string; value: string }> {
  const attr = (key: string) => readAttributeValue(input.attributes, input.keyMap, key);
  const rows: Array<{ label: string; value: string }> = [];

  pushDetailRow(rows, 'Description', input.description, { always: true });
  pushDetailRow(rows, 'Unit', input.unit, { always: true });

  const shelfLife =
    attr('shelf_life') ||
    attr('shelfLife') ||
    attr('best_before') ||
    attr('expiry') ||
    (input.lifespanValue && input.lifespanUnit
      ? `${input.lifespanValue} ${input.lifespanUnit}`
      : undefined) ||
    input.productInformation?.storageInformation;
  pushDetailRow(rows, 'Shelf life', shelfLife, { always: true });

  pushDetailRow(
    rows,
    'Country of origin',
    attr('country_origin') || attr('country_of_origin'),
    { always: true },
  );

  pushDetailRow(rows, 'Return policy', 'No return or replacement available for this product.', {
    always: true,
  });
  pushDetailRow(rows, 'Customer care details', 'support@extrahand.in', { always: true });
  pushDetailRow(
    rows,
    'Disclaimer',
    'Images are for representation purposes only. Actual product may vary slightly in size, colour, or packaging.',
    { always: true },
  );
  pushDetailRow(rows, 'Manufacturer', input.productInformation?.manufacturer, { always: true });

  pushDetailRow(rows, 'Seller name', input.seller.name, { always: true });
  pushDetailRow(rows, 'Seller address', input.seller.address, { always: true });
  pushDetailRow(rows, 'Seller FSSAI', input.seller.license, { always: true });
  pushDetailRow(rows, 'GSTIN', input.seller.gstin, { always: true });

  return rows;
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

/** Active AUTOMATIC product offers for this seller, keyed by masterProductId. */
export async function loadAutoOfferMap(
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
  options: { strictSeller?: boolean } = {},
) {
  const preferredListing = preferredSellerListingMap.get(productId);
  const anyListing = options.strictSeller ? undefined : anySellerListingMap.get(productId);

  if (options.strictSeller && !preferredListing) {
    return {
      price: referencePrice,
      mrp: undefined as number | undefined,
      inStock: false,
      purchasable: false,
      discountPercent: undefined as number | undefined,
      offerEndsAt: undefined as string | undefined,
      hasListing: false,
      stock: 0,
      availableQuantity: 0,
    };
  }

  const inStock = Boolean(
    options.strictSeller ? preferredListing?.inStock : anyListing?.inStock || preferredListing?.inStock,
  );

  let price = referencePrice;
  let mrp: number | undefined;

  if (preferredListing?.inStock) {
    price = preferredListing.price;
    mrp = preferredListing.mrp;
  } else if (!options.strictSeller && anyListing?.inStock) {
    price = anyListing.price;
    mrp = anyListing.mrp;
  } else if (preferredListing) {
    price = preferredListing.price;
    mrp = preferredListing.mrp;
  } else if (!options.strictSeller && anyListing) {
    price = anyListing.price;
    mrp = anyListing.mrp;
  }

  let discountPercent: number | undefined;
  let offerEndsAt: string | undefined;

  if (autoOffer && preferredListing) {
    const listPricePaise = Math.round(price * 100);
    const discPaise = discountForAmount(autoOffer, listPricePaise);
    if (discPaise > 0) {
      const dealPricePaise = listPricePaise - discPaise;
      const mrpPaise = Math.max(Math.round((mrp ?? 0) * 100), listPricePaise);
      price = dealPricePaise / 100;
      mrp = mrpPaise / 100;
      discountPercent = Math.round(((mrpPaise - dealPricePaise) / mrpPaise) * 100);
      offerEndsAt = autoOffer.endsAt.toISOString();
    }
  }

  const stock = preferredListing?.stock ?? anyListing?.stock ?? 0;
  const availableQuantity = preferredListing?.availableQuantity ?? anyListing?.availableQuantity ?? 0;

  return {
    price,
    mrp,
    inStock: options.strictSeller ? Boolean(preferredListing?.inStock) : inStock,
    purchasable: options.strictSeller
      ? Boolean(preferredListing?.purchasable)
      : inStock,
    stock,
    availableQuantity,
    discountPercent,
    offerEndsAt,
    hasListing: Boolean(preferredListing || anyListing),
  };
}

function mapProductsToStore(
  products: StorefrontMasterProductRow[],
  imageMap: Map<string, string>,
  preferredSellerListingMap: Map<string, SellerListingInfo>,
  anySellerListingMap: Map<string, SellerListingInfo>,
  keyMap: Map<string, string>,
  autoOfferMap: Map<string, AutoOfferInfo> = new Map(),
  options: { strictSeller?: boolean } = {},
): StoreProduct[] {
  const mapped: StoreProduct[] = [];

  for (const product of products) {
    const id = product._id.toString();
    const imageUrl = imageMap.get(id) || '';

    const referencePrice = (product.sellingPricePaise ?? 0) / 100;
    const availability = resolveStoreProductAvailability(
      id,
      referencePrice,
      preferredSellerListingMap,
      anySellerListingMap,
      autoOfferMap.get(id),
      options,
    );

    // Nearby store is serviceable: keep catalog products visible even without a
    // listing at this seller — mark them out of stock / not purchasable.
    const unit = resolveProductUnit(product.attributes, keyMap);

    mapped.push({
      id: product.slug,
      name: product.name,
      unit,
      price: availability.price,
      mrp: availability.mrp,
      imageUrl: imageUrl ? resolvePublicAssetUrl(imageUrl) : '',
      brand: product.brand,
      description: product.description,
      subcategorySlug: populatedSlug(product.subcategoryId),
      categorySlug: populatedSlug(product.categoryId),
      productTypeSlug: populatedSlug(product.productTypeId),
      inStock: availability.inStock,
      purchasable: availability.purchasable,
      availableAtCurrentLocation: availability.hasListing,
      stock: availability.stock,
      availableQuantity: availability.availableQuantity,
      lifespanValue: product.lifespanValue,
      lifespanUnit: product.lifespanUnit,
      discountPercent: availability.discountPercent,
      offerEndsAt: availability.offerEndsAt,
    });
  }

  return mapped;
}

async function enrichProductBatch(
  products: StorefrontMasterProductRow[],
  sellerObjectId: Types.ObjectId | null,
  keyMap: Map<string, string>,
  options: { strictSeller?: boolean } = {},
): Promise<StoreProduct[]> {
  if (!products.length) return [];

  const productIds = products.map((product) => product._id);
  // Honor strictSeller even with no nearby seller — empty preferred listings → all OOS.
  const strict = Boolean(options.strictSeller);
  const [imageMap, preferredSellerListingMap, anySellerListingMap, autoOfferMap] = await Promise.all([
    loadPrimaryProductImages(productIds),
    loadPreferredSellerListingMap(productIds, sellerObjectId),
    strict ? Promise.resolve(new Map<string, SellerListingInfo>()) : loadAnySellerListingMap(productIds),
    loadAutoOfferMap(productIds, sellerObjectId),
  ]);

  return mapProductsToStore(
    products,
    imageMap,
    preferredSellerListingMap,
    anySellerListingMap,
    keyMap,
    autoOfferMap,
    { strictSeller: strict },
  );
}

async function loadAvailableSellerProductIds(
  sellerId: Types.ObjectId,
): Promise<Types.ObjectId[]> {
  const listings = await SellerListing.find({
    sellerId,
    status: 'ACTIVE',
    reviewStatus: 'APPROVED',
    availability: { $in: ['AVAILABLE', 'LIMITED'] },
    $expr: {
      $gt: [
        { $subtract: [{ $ifNull: ['$stock', 0] }, { $ifNull: ['$reserved', 0] }] },
        0,
      ],
    },
  })
    .select('masterProductId')
    .lean();
  return listings.map((listing) => listing.masterProductId);
}

export class StorefrontService {
  static async getCategoryGroups(
    _query: StorefrontQuery = {},
  ): Promise<StoreCategoryGroup[]> {
    const [categories, subcategories] = await Promise.all([
      Category.find({ status: 'ACTIVE' })
        .select('name slug imageUrl displayOrder')
        .sort({ displayOrder: 1 })
        .lean(),
      Subcategory.find({ status: 'ACTIVE' })
        .select('categoryId name slug imageUrl displayOrder')
        .sort({ displayOrder: 1 })
        .lean(),
    ]);

    const subsByCategory = new Map<string, typeof subcategories>();
    for (const sub of subcategories) {
      const key = sub.categoryId.toString();
      const list = subsByCategory.get(key) || [];
      list.push(sub);
      subsByCategory.set(key, list);
    }

    return categories
      .map((cat) => ({
        id: cat.slug,
        title: cat.name,
        imageUrl: resolvePublicAssetUrl(cat.imageUrl || ''),
        subcategories: (subsByCategory.get(cat._id.toString()) || []).map((sub) => ({
          id: sub.slug,
          label: sub.name,
          imageUrl: resolvePublicAssetUrl(sub.imageUrl || ''),
        })),
      }))
      .filter((category) => category.subcategories.length > 0);
  }

  static async listProducts(query: {
    page?: number;
    limit?: number;
    search?: string;
    categorySlug?: string;
    subcategorySlug?: string;
    productTypeSlug?: string;
    brands?: string;
    minPrice?: string | number;
    maxPrice?: string | number;
    sellerId?: string;
    lat?: number;
    lng?: number;
    pinCode?: string;
    city?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const resolved = await resolveStorefrontSellerForLocation({
      sellerId: query.sellerId,
      lat: query.lat,
      lng: query.lng,
      pinCode: query.pinCode,
      city: query.city,
    });

    const emptyPage = {
      serviceable: resolved.serviceable,
      locationUsed: resolved.locationUsed,
      store: storefrontStoreDto(resolved),
      items: [] as StoreProduct[],
      total: 0,
      page,
      limit,
      totalPages: 0,
    };

    if (!resolved.serviceable || !resolved.sellerId) {
      return emptyPage;
    }

    const sellerObjectId = resolved.sellerId;
    const hasSearch = Boolean(query.search?.trim());
    const [categoryFiltersRaw, keyMap] = await Promise.all([
      resolveCategoryFilters(query),
      buildAttributeKeyMap(),
    ]);

    // Free-text search must not die on unknown group slugs (e.g. home "fresh").
    // Prefer scoped results when the slug resolves; otherwise search the full catalog.
    const categoryFilters =
      hasSearch && categoryFiltersRaw.empty
        ? { match: {}, empty: false as const }
        : categoryFiltersRaw;

    if (categoryFilters.empty) {
      return emptyPage;
    }

    const availableProductIds = await loadAvailableSellerProductIds(sellerObjectId);
    if (!availableProductIds.length) {
      return emptyPage;
    }

    const match = applyStorefrontListFilters(
      { ...categoryFilters.match, _id: { $in: availableProductIds } },
      {
        search: query.search,
        brands: query.brands,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
      },
    );

    // Text search: match ACTIVE master products by name/brand/slug/description.
    // Listing membership is not required — nearby stock is applied in enrich (OOS ok).
    let products: StorefrontMasterProductRow[];
    let total: number;

    if (hasSearch) {
      const filter: FilterQuery<typeof MasterProduct> = { status: 'ACTIVE', ...match };
      const [count, rows] = await Promise.all([
        MasterProduct.countDocuments(filter),
        MasterProduct.find(filter)
          .select(STOREFRONT_PRODUCT_SELECT)
          .populate([
            { path: 'subcategoryId', select: 'slug' },
            { path: 'categoryId', select: 'slug' },
            { path: 'productTypeId', select: 'slug' },
          ])
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);
      products = rows as StorefrontMasterProductRow[];
      total = count;
    } else {
      const pageResult = await fetchListedMasterProductsPage(
        match,
        skip,
        limit,
        sellerObjectId,
      );
      products = pageResult.items;
      total = pageResult.total;
    }

    const operational = await resolveStoreOperationalState(sellerObjectId);
    const storeItems = (
      await enrichProductBatch(products, sellerObjectId, keyMap, {
        strictSeller: true,
      })
    ).map((product) => applyStoreOperationalState(product, operational));
    storeItems.sort((a, b) => Number(b.inStock) - Number(a.inStock));

    return {
      serviceable: true,
      locationUsed: resolved.locationUsed,
      store: { ...storefrontStoreDto(resolved)!, ...operational },
      items: storeItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  static async getProductBySlug(slug: string, query: StorefrontQuery = {}): Promise<StoreProductDetailPayload> {
    const resolved = await resolveStorefrontSellerForLocation(query);
    if (!resolved.serviceable || !resolved.sellerId) {
      throw new AppError('Store is not available at this location', 404, {
        code: 'STORE_UNSERVICEABLE',
        serviceable: false,
        locationUsed: resolved.locationUsed,
      });
    }

    const sellerObjectId = resolved.sellerId;
    const product = await MasterProduct.findOne({ slug, status: 'ACTIVE' })
      .select(`${STOREFRONT_PRODUCT_SELECT} productInformation`)
      .populate('subcategoryId', 'slug name')
      .populate('categoryId', 'slug name')
      .populate('productTypeId', 'slug name')
      .lean();

    if (!product) throw new AppError('Product not found', 404);

    const [images, keyMap, preferredSellerListingMap, autoOfferMap, onboarding, operational] = await Promise.all([
      ProductImage.find({ masterProductId: product._id })
        .select('imageUrl isPrimary displayOrder')
        .sort({ displayOrder: 1 })
        .lean(),
      buildAttributeKeyMap(),
      loadPreferredSellerListingMap([product._id], sellerObjectId),
      loadAutoOfferMap([product._id], sellerObjectId),
      SellerOnboarding.findOne({ sellerId: sellerObjectId, status: 'APPROVED' })
        .select(
          'shopName address area locality city state pincode fssaiNumber gstin',
        )
        .lean(),
      resolveStoreOperationalState(sellerObjectId),
    ]);

    const preferredListing = preferredSellerListingMap.get(product._id.toString());

    const referencePrice = (product.sellingPricePaise ?? 0) / 100;
    const availability = resolveStoreProductAvailability(
      product._id.toString(),
      referencePrice,
      preferredSellerListingMap,
      new Map(),
      preferredListing ? autoOfferMap.get(product._id.toString()) : undefined,
      { strictSeller: true },
    );

    const primaryImage = images.find((img) => img.isPrimary) || images[0];
    const unit = resolveProductUnit(product.attributes, keyMap);

    const storeProduct = applyStoreOperationalState({
      id: product.slug,
      name: product.name,
      unit,
      price: availability.price,
      mrp: availability.mrp,
      imageUrl: resolvePublicAssetUrl(primaryImage?.imageUrl || ''),
      brand: product.brand,
      description: product.description,
      subcategorySlug: populatedSlug(product.subcategoryId as { slug?: string } | Types.ObjectId),
      categorySlug: populatedSlug(product.categoryId as { slug?: string } | Types.ObjectId),
      productTypeSlug: populatedSlug(product.productTypeId as { slug?: string } | Types.ObjectId | undefined),
      inStock: availability.inStock,
      purchasable: availability.purchasable,
      availableAtCurrentLocation: availability.hasListing,
      stock: availability.stock,
      availableQuantity: availability.availableQuantity,
      lifespanValue: product.lifespanValue,
      lifespanUnit: product.lifespanUnit,
      discountPercent: availability.discountPercent,
      offerEndsAt: availability.offerEndsAt,
    }, operational);

    const relatedCandidates = await loadRelatedMasterProducts(product, 24);
    const related = (
      await enrichProductBatch(relatedCandidates, sellerObjectId, keyMap, { strictSeller: true })
    )
      .map((item) => applyStoreOperationalState(item, operational))
      .filter((item) => item.inStock && item.purchasable)
      .slice(0, 8);

    const productInformation = mapStorefrontProductInformation(product.productInformation);

    const fssaiRaw = onboarding?.fssaiNumber?.trim();
    const sellerPayload = {
      name: displayOrUnavailable(resolved.shopName || onboarding?.shopName),
      address: displayOrUnavailable(
        onboarding ? formatSellerAddress(onboarding) : resolved.shopCity,
      ),
      gstin: displayOrUnavailable(onboarding?.gstin),
      license: fssaiRaw ? `FSSAI ${fssaiRaw}` : NOT_AVAILABLE,
      ...(resolved.distanceKm != null ? { distanceKm: resolved.distanceKm } : {}),
    };

    const highlights = buildPdpHighlights({
      brand: product.brand,
      unit,
      lifespanValue: product.lifespanValue,
      lifespanUnit: product.lifespanUnit,
      categoryName: populatedName(product.categoryId as { name?: string } | Types.ObjectId),
      subcategoryName: populatedName(product.subcategoryId as { name?: string } | Types.ObjectId),
      productTypeName: populatedName(product.productTypeId as { name?: string } | Types.ObjectId),
      attributes: product.attributes || [],
      keyMap,
      productInformation,
    });

    const information = buildPdpInformation({
      description: product.description,
      unit,
      lifespanValue: product.lifespanValue,
      lifespanUnit: product.lifespanUnit,
      attributes: product.attributes || [],
      keyMap,
      productInformation,
      seller: sellerPayload,
    });

    return {
      product: storeProduct,
      gallery: images.map((img) => resolvePublicAssetUrl(img.imageUrl)),
      highlights:
        highlights.length > 0
          ? highlights
          : [
              { label: 'Brand', value: product.brand || '—' },
              { label: 'Unit', value: unit },
            ],
      information,
      ...(productInformation ? { productInformation } : {}),
      related,
      similar: related.slice(0, 4),
      seller: sellerPayload,
      serviceable: true,
      locationUsed: resolved.locationUsed,
      store: { ...storefrontStoreDto(resolved)!, ...operational },
    } as StoreProductDetailPayload & {
      serviceable: boolean;
      locationUsed: boolean;
      store: ReturnType<typeof storefrontStoreDto>;
    };
  }

  static async getHome(query: StorefrontQuery = {}) {
    const resolved = await resolveStorefrontSellerForLocation(query);

    if (!resolved.serviceable || !resolved.sellerId) {
      return {
        serviceable: false,
        locationUsed: resolved.locationUsed,
        store: null,
        categories: [],
        bestsellers: [],
        freshPicks: [],
        popular: [],
        recommended: [],
      } satisfies StoreHomePayload;
    }

    const sellerObjectId = resolved.sellerId;
    const [groups, keyMap, fruitsVeg, operational] = await Promise.all([
      this.getCategoryGroups(query),
      buildAttributeKeyMap(),
      Subcategory.findOne({ slug: 'fruits-veg', status: 'ACTIVE' }).select('_id').lean(),
      resolveStoreOperationalState(sellerObjectId),
    ]);

    const categories = groups.slice(0, 8).map((group) => ({
      id: group.id,
      label: group.title,
      imageUrl: resolvePublicAssetUrl(group.imageUrl),
    }));

    const availableProductIds = await loadAvailableSellerProductIds(sellerObjectId);
    const availableFilter: FilterQuery<typeof MasterProduct> = {
      _id: { $in: availableProductIds },
    };
    const freshFilter: FilterQuery<typeof MasterProduct> = fruitsVeg
      ? { ...availableFilter, subcategoryId: fruitsVeg._id }
      : availableFilter;

    const [bestsellerRows, freshRows, popularRows, recommendedRows] = await Promise.all([
      fetchListedMasterProducts(availableFilter, 10, sellerObjectId),
      fetchListedMasterProducts(freshFilter, 10, sellerObjectId),
      fetchListedMasterProducts(availableFilter, 8, sellerObjectId),
      fetchListedMasterProducts(availableFilter, 8, sellerObjectId),
    ]);

    const uniqueById = new Map<string, StorefrontMasterProductRow>();
    for (const row of [...bestsellerRows, ...freshRows, ...popularRows, ...recommendedRows]) {
      uniqueById.set(row._id.toString(), row);
    }
    const allRows = [...uniqueById.values()];
    const productIds = allRows.map((row) => row._id);

    const [imageMap, preferredSellerListingMap, autoOfferMap] = await Promise.all([
      loadPrimaryProductImages(productIds),
      loadPreferredSellerListingMap(productIds, sellerObjectId),
      loadAutoOfferMap(productIds, sellerObjectId),
    ]);

    const mapSection = (rows: StorefrontMasterProductRow[]) =>
      mapProductsToStore(
        rows,
        imageMap,
        preferredSellerListingMap,
        new Map(),
        keyMap,
        autoOfferMap,
        { strictSeller: true },
      )
        .map((product) => applyStoreOperationalState(product, operational))
        .filter((product) => product.inStock && product.purchasable);

    const store = { ...storefrontStoreDto(resolved)!, ...operational };

    return {
      serviceable: true,
      locationUsed: resolved.locationUsed,
      store,
      categories,
      bestsellers: mapSection(bestsellerRows),
      freshPicks: mapSection(freshRows),
      popular: mapSection(popularRows),
      recommended: mapSection(recommendedRows),
    } satisfies StoreHomePayload;
  }

  /** Sidebar rails for a subcategory PLP — active catalogue product types. */
  static async getSubcategoryProductTypes(
    subcategorySlug: string,
    query: StorefrontQuery = {},
  ): Promise<StoreProductTypeRail[]> {
    const resolved = await resolveStorefrontSellerForLocation(query);
    if (!resolved.serviceable || !resolved.sellerId) return [];

    const sub = await Subcategory.findOne({ slug: subcategorySlug, status: 'ACTIVE' })
      .select('_id imageUrl')
      .lean();
    if (!sub) return [];

    const availableProductIds = await loadAvailableSellerProductIds(resolved.sellerId);
    if (!availableProductIds.length) return [];
    const products = await MasterProduct.find({
      _id: { $in: availableProductIds },
      status: 'ACTIVE',
      subcategoryId: sub._id,
      productTypeId: { $exists: true, $ne: null },
    })
      .select('_id productTypeId')
      .lean();
    if (!products.length) return [];

    const typeIds = [
      ...new Set(products.map((product) => product.productTypeId.toString())),
    ].map((id) => new Types.ObjectId(id));
    const types = await ProductType.find({
      _id: { $in: typeIds },
      subcategoryId: sub._id,
      status: 'ACTIVE',
    })
      .sort({ displayOrder: 1, name: 1 })
      .select('_id name slug')
      .lean();

    if (!types.length) return [];

    const productIds = products.map((product) => product._id);
    const imageByProductId = productIds.length
      ? await loadPrimaryProductImages(productIds)
      : new Map<string, string>();

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

  static async getFilterFacets(
    query: StorefrontQuery & {
      categorySlug?: string;
      subcategorySlug?: string;
      productTypeSlug?: string;
    },
  ): Promise<StorefrontFilterFacets> {
    const resolved = await resolveStorefrontSellerForLocation(query);
    if (!resolved.serviceable || !resolved.sellerId) {
      return { types: [], brands: [], prices: [] };
    }
    const availableProductIds = await loadAvailableSellerProductIds(resolved.sellerId);
    if (!availableProductIds.length) {
      return { types: [], brands: [], prices: [] };
    }

    const typeScope = await resolveCategoryFilters({
      categorySlug: query.categorySlug,
      subcategorySlug: query.subcategorySlug,
    });

    let typeOptions: Array<{ id: string; label: string; imageUrl?: string; typeObjectId?: string }> = [];
    if (!typeScope.empty) {
      if (query.subcategorySlug) {
        const rails = await StorefrontService.getSubcategoryProductTypes(
          query.subcategorySlug,
          query,
        );
        const typeDocs = await ProductType.find({
          slug: { $in: rails.map((rail) => rail.id) },
          status: 'ACTIVE',
        })
          .select('_id slug')
          .lean();
        const idBySlug = new Map(typeDocs.map((doc) => [doc.slug, doc._id.toString()]));
        typeOptions = rails.map((rail) => ({
          id: rail.id,
          label: rail.label,
          imageUrl: rail.imageUrl,
          typeObjectId: idBySlug.get(rail.id),
        }));
      } else if (query.categorySlug) {
        typeOptions = await StorefrontService.listCategoryProductTypeOptions(query.categorySlug);
      }
    }

    const aisleScope = await resolveCategoryFilters({
      categorySlug: query.categorySlug,
      subcategorySlug: query.subcategorySlug,
    });
    const facetScope = await resolveCategoryFilters(query);
    if (aisleScope.empty || facetScope.empty) {
      return {
        types: typeOptions.map(({ id, label, imageUrl }) => ({
          id,
          label,
          imageUrl,
          count: 0,
        })),
        brands: [],
        prices: [],
      };
    }

    const aisleFacets = await fetchListedProductFacets({
      ...aisleScope.match,
      _id: { $in: availableProductIds },
    });
    const railFacets =
      query.productTypeSlug?.trim() && query.productTypeSlug.trim() !== ''
        ? await fetchListedProductFacets({
            ...facetScope.match,
            _id: { $in: availableProductIds },
          })
        : aisleFacets;

    const types = typeOptions
      .map(({ id, label, imageUrl, typeObjectId }) => ({
        id,
        label,
        imageUrl,
        count: typeObjectId ? aisleFacets.typeCountsById.get(typeObjectId) ?? 0 : 0,
      }))
      .filter((type) => type.count > 0);

    const prices = STOREFRONT_PRICE_BUCKETS.filter(
      (bucket) => (railFacets.priceCounts[bucket.id] ?? 0) > 0,
    ).map(({ id, label, min, max }) => ({
      id,
      label,
      count: railFacets.priceCounts[id] ?? 0,
      ...(min != null ? { min } : {}),
      ...(max != null ? { max } : {}),
    }));

    return {
      types,
      brands: railFacets.brands.map(({ label, count }) => ({ id: label, label, count })),
      prices,
    };
  }

  private static async listCategoryProductTypeOptions(
    categorySlug: string,
  ): Promise<Array<{ id: string; label: string; imageUrl?: string; typeObjectId?: string }>> {
    const category = await Category.findOne({ slug: categorySlug, status: 'ACTIVE' })
      .select('_id imageUrl')
      .lean();
    if (!category) return [];

    const types = await ProductType.find({ categoryId: category._id, status: 'ACTIVE' })
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
    const imageByProductId = productIds.length
      ? await loadPrimaryProductImages(productIds)
      : new Map<string, string>();

    const imageByTypeId = new Map<string, string>();
    for (const product of products) {
      const typeId = product.productTypeId.toString();
      if (imageByTypeId.has(typeId)) continue;
      const imageUrl = imageByProductId.get(product._id.toString());
      if (imageUrl) imageByTypeId.set(typeId, imageUrl);
    }

    const fallbackImage = resolvePublicAssetUrl(category.imageUrl || '');

    return types.map((type) => ({
      id: type.slug,
      label: type.name,
      imageUrl: imageByTypeId.get(type._id.toString()) || fallbackImage,
      typeObjectId: type._id.toString(),
    }));
  }

  /** Resolve storefront product cards for cart/wishlist enrichment. */
  static async resolveProductsBySlugs(
    slugs: string[],
    query: StorefrontQuery = {},
  ): Promise<Map<string, StoreProduct>> {
    const uniqueSlugs = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
    if (!uniqueSlugs.length) return new Map();

    const resolved = await resolveStorefrontSellerForLocation(query);

    const rawProducts = await MasterProduct.find({ slug: { $in: uniqueSlugs }, status: 'ACTIVE' })
      .select(STOREFRONT_PRODUCT_SELECT)
      .lean();
    if (!rawProducts.length) return new Map();

    const products = await attachCategorySlugs(rawProducts);
    const keyMap = await buildAttributeKeyMap();
    // Nearby / unserviceable: still return cards so cart can show Out of stock.
    let mapped = await enrichProductBatch(
      products,
      resolved.serviceable ? resolved.sellerId : null,
      keyMap,
      { strictSeller: true },
    );
    if (resolved.serviceable && resolved.sellerId) {
      const operational = await resolveStoreOperationalState(resolved.sellerId);
      mapped = mapped.map((product) =>
        applyStoreOperationalState(product, operational),
      );
    }

    return new Map(mapped.map((product) => [product.id, product]));
  }

  static async resolveSellerStoreSnapshot(query: StorefrontQuery = {}) {
    const resolved = await resolveStorefrontSellerForLocation(query);
    if (!resolved.serviceable || !resolved.sellerId) return null;

    const [seller, onboarding] = await Promise.all([
      Seller.findById(resolved.sellerId).select('userId fullName').lean(),
      SellerOnboarding.findOne({ sellerId: resolved.sellerId }).select('shopName city').lean(),
    ]);
    if (!seller) return null;

    return {
      sellerId: resolved.sellerId,
      sellerUserId: seller.userId,
      shopName:
        resolved.shopName ||
        onboarding?.shopName?.trim() ||
        seller.fullName?.trim() ||
        'Grocery store',
      shopCity: resolved.shopCity || onboarding?.city?.trim() || undefined,
      distanceKm: resolved.distanceKm,
      locationUsed: resolved.locationUsed,
    };
  }

  /** Expose last resolve result helpers for cart/checkout. */
  static async resolveStorefrontSeller(
    query: StorefrontQuery = {},
  ): Promise<StorefrontSellerResolveResult> {
    return resolveStorefrontSellerForLocation(query);
  }
}

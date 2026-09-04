import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import MasterProduct from '../models/MasterProduct';
import ProductImage from '../models/ProductImage';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
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
  resolveStorefrontSellerId,
  SellerListingInfo,
} from './storefront/storefrontListingQueries';
import {
  attachCategorySlugs,
  buildAttributeKeyMap,
  fetchListedMasterProducts,
  fetchListedMasterProductsPage,
  loadPrimaryProductImages,
  loadRelatedMasterProducts,
  resolveCategoryFilters,
  STOREFRONT_PRODUCT_SELECT,
  StorefrontMasterProductRow,
} from './storefront/storefrontProductQueries';

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

function mapProductsToStore(
  products: StorefrontMasterProductRow[],
  imageMap: Map<string, string>,
  preferredSellerListingMap: Map<string, SellerListingInfo>,
  anySellerListingMap: Map<string, SellerListingInfo>,
  keyMap: Map<string, string>,
  autoOfferMap: Map<string, AutoOfferInfo> = new Map(),
): StoreProduct[] {
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

    const unit = resolveProductUnit(product.attributes, keyMap);

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

async function enrichProductBatch(
  products: StorefrontMasterProductRow[],
  sellerObjectId: Types.ObjectId | null,
  keyMap: Map<string, string>,
): Promise<StoreProduct[]> {
  if (!products.length) return [];

  const productIds = products.map((product) => product._id);
  const [imageMap, preferredSellerListingMap, anySellerListingMap, autoOfferMap] = await Promise.all([
    loadPrimaryProductImages(productIds),
    loadPreferredSellerListingMap(productIds, sellerObjectId),
    loadAnySellerListingMap(productIds),
    loadAutoOfferMap(productIds, sellerObjectId),
  ]);

  return mapProductsToStore(
    products,
    imageMap,
    preferredSellerListingMap,
    anySellerListingMap,
    keyMap,
    autoOfferMap,
  );
}

export class StorefrontService {
  static async getCategoryGroups(): Promise<StoreCategoryGroup[]> {
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
    const skip = (page - 1) * limit;

    const [sellerObjectId, categoryFilters, keyMap] = await Promise.all([
      resolveStorefrontSellerId(query.sellerId),
      resolveCategoryFilters(query),
      buildAttributeKeyMap(),
    ]);

    if (categoryFilters.empty) {
      return { items: [] as StoreProduct[], total: 0, page, limit, totalPages: 0 };
    }

    const match: FilterQuery<typeof MasterProduct> = { ...categoryFilters.match };
    if (query.search?.trim()) {
      match.$or = [
        { name: { $regex: query.search.trim(), $options: 'i' } },
        { brand: { $regex: query.search.trim(), $options: 'i' } },
      ];
    }

    const { items: products, total } = await fetchListedMasterProductsPage(match, skip, limit);
    const storeItems = await enrichProductBatch(products, sellerObjectId, keyMap);

    return {
      items: storeItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  static async getProductBySlug(slug: string, query: StorefrontQuery = {}): Promise<StoreProductDetailPayload> {
    const product = await MasterProduct.findOne({ slug, status: 'ACTIVE' })
      .select(`${STOREFRONT_PRODUCT_SELECT} productInformation`)
      .populate('subcategoryId', 'slug name')
      .populate('categoryId', 'slug name')
      .lean();

    if (!product) throw new AppError('Product not found', 404);

    const [images, sellerObjectId, keyMap] = await Promise.all([
      ProductImage.find({ masterProductId: product._id })
        .select('imageUrl isPrimary displayOrder')
        .sort({ displayOrder: 1 })
        .lean(),
      resolveStorefrontSellerId(query.sellerId),
      buildAttributeKeyMap(),
    ]);

    const [preferredSellerListingMap, anySellerListingMap, autoOfferMap] = await Promise.all([
      loadPreferredSellerListingMap([product._id], sellerObjectId),
      loadAnySellerListingMap([product._id]),
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
    const related = (await enrichProductBatch(relatedCandidates, sellerObjectId, keyMap)).slice(0, 8);

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
    const [groups, keyMap, sellerObjectId, fruitsVeg, storeSnapshot] = await Promise.all([
      this.getCategoryGroups(),
      buildAttributeKeyMap(),
      resolveStorefrontSellerId(query.sellerId),
      Subcategory.findOne({ slug: 'fruits-veg', status: 'ACTIVE' }).select('_id').lean(),
      query.sellerId ? this.resolveSellerStoreSnapshot(query) : Promise.resolve(null),
    ]);

    const categories = groups.slice(0, 8).map((group) => ({
      id: group.id,
      label: group.title,
      imageUrl: resolvePublicAssetUrl(group.imageUrl),
    }));

    const freshFilter: FilterQuery<typeof MasterProduct> = fruitsVeg
      ? { subcategoryId: fruitsVeg._id }
      : {};

    const [bestsellerRows, freshRows, popularRows, recommendedRows] = await Promise.all([
      fetchListedMasterProducts({}, 10),
      fetchListedMasterProducts(freshFilter, 10),
      fetchListedMasterProducts({}, 8),
      fetchListedMasterProducts({}, 8),
    ]);

    const uniqueById = new Map<string, StorefrontMasterProductRow>();
    for (const row of [...bestsellerRows, ...freshRows, ...popularRows, ...recommendedRows]) {
      uniqueById.set(row._id.toString(), row);
    }
    const allRows = [...uniqueById.values()];
    const productIds = allRows.map((row) => row._id);

    const [imageMap, preferredSellerListingMap, anySellerListingMap, autoOfferMap] = await Promise.all([
      loadPrimaryProductImages(productIds),
      loadPreferredSellerListingMap(productIds, sellerObjectId),
      loadAnySellerListingMap(productIds),
      loadAutoOfferMap(productIds, sellerObjectId),
    ]);

    const mapSection = (rows: StorefrontMasterProductRow[]) =>
      mapProductsToStore(rows, imageMap, preferredSellerListingMap, anySellerListingMap, keyMap, autoOfferMap).sort(
        (a, b) => Number(b.inStock) - Number(a.inStock),
      );

    return {
      store: storeSnapshot
        ? {
            sellerId: storeSnapshot.sellerId.toString(),
            shopName: storeSnapshot.shopName,
            shopCity: storeSnapshot.shopCity,
          }
        : null,
      categories,
      bestsellers: mapSection(bestsellerRows),
      freshPicks: mapSection(freshRows),
      popular: mapSection(popularRows),
      recommended: mapSection(recommendedRows),
    } satisfies StoreHomePayload;
  }

  /** Sidebar rails for a subcategory PLP — active catalogue product types. */
  static async getSubcategoryProductTypes(subcategorySlug: string): Promise<StoreProductTypeRail[]> {
    const sub = await Subcategory.findOne({ slug: subcategorySlug, status: 'ACTIVE' })
      .select('_id imageUrl')
      .lean();
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

  /** Resolve storefront product cards for cart/wishlist enrichment. */
  static async resolveProductsBySlugs(
    slugs: string[],
    query: StorefrontQuery = {},
  ): Promise<Map<string, StoreProduct>> {
    const uniqueSlugs = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
    if (!uniqueSlugs.length) return new Map();

    const rawProducts = await MasterProduct.find({ slug: { $in: uniqueSlugs }, status: 'ACTIVE' })
      .select(STOREFRONT_PRODUCT_SELECT)
      .lean();
    if (!rawProducts.length) return new Map();

    const products = await attachCategorySlugs(rawProducts);
    const sellerObjectId = await resolveStorefrontSellerId(query.sellerId);
    const keyMap = await buildAttributeKeyMap();
    const mapped = await enrichProductBatch(products, sellerObjectId, keyMap);

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

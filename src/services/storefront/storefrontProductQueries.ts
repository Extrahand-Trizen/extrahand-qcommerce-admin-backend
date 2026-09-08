import { FilterQuery, PipelineStage, Types } from 'mongoose';
import MasterProduct from '../../models/MasterProduct';
import ProductImage from '../../models/ProductImage';
import Attribute from '../../models/Attribute';
import Subcategory from '../../models/Subcategory';
import Category from '../../models/Category';
import ProductType from '../../models/ProductType';
import { resolvePublicAssetUrl } from '../../utils/media';
import { getOrLoad } from './storefrontCache';
import {
  hasListedProductMatchStage,
  listedProductLookupStage,
} from './storefrontListingQueries';

export const STOREFRONT_PRODUCT_SELECT =
  'name slug brand description sellingPricePaise attributes subcategoryId categoryId productTypeId lifespanValue lifespanUnit createdAt';

export type StorefrontMasterProductRow = {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  brand?: string;
  description?: string;
  sellingPricePaise?: number;
  attributes: Array<{ attributeId: Types.ObjectId | string; value: unknown }>;
  subcategoryId?: { slug?: string } | Types.ObjectId;
  categoryId?: { slug?: string } | Types.ObjectId;
  productTypeId?: { slug?: string } | Types.ObjectId;
  lifespanValue?: number;
  lifespanUnit?: string;
};

const SUBCATEGORY_COLLECTION = () => Subcategory.collection.name;
const CATEGORY_COLLECTION = () => Category.collection.name;
const PRODUCT_TYPE_COLLECTION = () => ProductType.collection.name;

export async function buildAttributeKeyMap(): Promise<Map<string, string>> {
  return getOrLoad('storefront:attribute-key-map', async () => {
    const attrs = await Attribute.find({ isActive: true }).select('_id key').lean();
    return new Map(attrs.map((a) => [a._id.toString(), a.key]));
  }, 300_000);
}

export async function loadPrimaryProductImages(
  productIds: Types.ObjectId[],
): Promise<Map<string, string>> {
  if (!productIds.length) return new Map();

  const images = await ProductImage.aggregate<{
    _id: Types.ObjectId;
    imageUrl: string;
  }>([
    { $match: { masterProductId: { $in: productIds } } },
    { $sort: { isPrimary: -1, displayOrder: 1 } },
    {
      $group: {
        _id: '$masterProductId',
        imageUrl: { $first: '$imageUrl' },
      },
    },
  ]);

  const imageMap = new Map<string, string>();
  for (const img of images) {
    imageMap.set(img._id.toString(), resolvePublicAssetUrl(img.imageUrl));
  }
  return imageMap;
}

function slugLookupStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: SUBCATEGORY_COLLECTION(),
        localField: 'subcategoryId',
        foreignField: '_id',
        as: '_subcategory',
        pipeline: [{ $project: { slug: 1 } }],
      },
    },
    {
      $lookup: {
        from: CATEGORY_COLLECTION(),
        localField: 'categoryId',
        foreignField: '_id',
        as: '_category',
        pipeline: [{ $project: { slug: 1 } }],
      },
    },
    {
      $lookup: {
        from: PRODUCT_TYPE_COLLECTION(),
        localField: 'productTypeId',
        foreignField: '_id',
        as: '_productType',
        pipeline: [{ $project: { slug: 1 } }],
      },
    },
    {
      $project: {
        _id: 1,
        name: 1,
        slug: 1,
        brand: 1,
        description: 1,
        sellingPricePaise: 1,
        attributes: 1,
        lifespanValue: 1,
        lifespanUnit: 1,
        createdAt: 1,
        subcategoryId: { $arrayElemAt: ['$_subcategory', 0] },
        categoryId: { $arrayElemAt: ['$_category', 0] },
        productTypeId: { $arrayElemAt: ['$_productType', 0] },
      },
    },
  ];
}

/** Listed storefront products — DB-level filter, sort, and limit (no distinct + $in). */
export async function fetchListedMasterProducts(
  extraMatch: FilterQuery<typeof MasterProduct>,
  limit: number,
  sellerId?: Types.ObjectId | null,
): Promise<StorefrontMasterProductRow[]> {
  const pipeline: PipelineStage[] = [
    { $match: { status: 'ACTIVE', ...extraMatch } },
    listedProductLookupStage(sellerId),
    hasListedProductMatchStage(),
    { $sort: { createdAt: -1 } },
    { $limit: limit },
    ...slugLookupStages(),
  ];

  return MasterProduct.aggregate<StorefrontMasterProductRow>(pipeline);
}

export type ListedProductsPageResult = {
  items: StorefrontMasterProductRow[];
  total: number;
};

/** Paginated listed products — count and page both computed in MongoDB. */
export async function fetchListedMasterProductsPage(
  extraMatch: FilterQuery<typeof MasterProduct>,
  skip: number,
  limit: number,
  sellerId?: Types.ObjectId | null,
): Promise<ListedProductsPageResult> {
  const basePipeline: PipelineStage[] = [
    { $match: { status: 'ACTIVE', ...extraMatch } },
    listedProductLookupStage(sellerId),
    hasListedProductMatchStage(),
  ];

  const [countRows, items] = await Promise.all([
    MasterProduct.aggregate<{ total: number }>([...basePipeline, { $count: 'total' }]),
    MasterProduct.aggregate<StorefrontMasterProductRow>([
      ...basePipeline,
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      ...slugLookupStages(),
    ]),
  ]);

  return {
    items,
    total: countRows[0]?.total ?? 0,
  };
}

export type StorefrontPriceBucket = {
  id: string;
  label: string;
  min?: number;
  max?: number;
  count?: number;
};

export const STOREFRONT_PRICE_BUCKETS: StorefrontPriceBucket[] = [
  { id: 'under-50', label: 'Under ₹50', max: 50 },
  { id: '50-100', label: '₹50 - ₹100', min: 50, max: 100 },
  { id: '100-200', label: '₹100 - ₹200', min: 100, max: 200 },
  { id: '200-plus', label: '₹200+', min: 200 },
];

export type StorefrontFilterTypeOption = {
  id: string;
  label: string;
  imageUrl?: string;
  count: number;
};

export type StorefrontFilterBrandOption = {
  id: string;
  label: string;
  count: number;
};

export type StorefrontFilterFacets = {
  types: StorefrontFilterTypeOption[];
  brands: StorefrontFilterBrandOption[];
  prices: StorefrontPriceBucket[];
};

export function parseCsvQueryParam(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseCsvQueryParam(entry));
  }
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseRupeeBoundPaise(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const rupees = Number(value);
  if (!Number.isFinite(rupees) || rupees < 0) return undefined;
  return Math.round(rupees * 100);
}

function priceBucketExpression(bucket: { min?: number; max?: number }) {
  const parts: object[] = [];
  if (bucket.min != null) parts.push({ $gte: ['$sellingPricePaise', bucket.min * 100] });
  if (bucket.max != null) parts.push({ $lte: ['$sellingPricePaise', bucket.max * 100] });
  if (parts.length === 0) return true;
  if (parts.length === 1) return parts[0];
  return { $and: parts };
}

export async function resolveCategoryFilters(query: {
  categorySlug?: string;
  subcategorySlug?: string;
  productTypeSlug?: string;
}): Promise<{ match: FilterQuery<typeof MasterProduct>; empty: boolean }> {
  const match: FilterQuery<typeof MasterProduct> = {};

  if (query.subcategorySlug) {
    const sub = await Subcategory.findOne({ slug: query.subcategorySlug, status: 'ACTIVE' })
      .select('_id')
      .lean();
    if (!sub) return { match, empty: true };
    match.subcategoryId = sub._id;
  } else if (query.categorySlug) {
    const cat = await Category.findOne({ slug: query.categorySlug, status: 'ACTIVE' })
      .select('_id')
      .lean();
    if (!cat) return { match, empty: true };
    match.categoryId = cat._id;
  }

  const productTypeSlugs = parseCsvQueryParam(query.productTypeSlug);
  if (productTypeSlugs.length) {
    const productTypes = await ProductType.find({
      slug: { $in: productTypeSlugs },
      status: 'ACTIVE',
    })
      .select('_id')
      .lean();
    if (!productTypes.length) return { match, empty: true };
    const typeIds = productTypes.map((type) => type._id);
    match.productTypeId = typeIds.length === 1 ? typeIds[0] : { $in: typeIds };
  }

  return { match, empty: false };
}

export function applyStorefrontListFilters(
  match: FilterQuery<typeof MasterProduct>,
  query: {
    search?: string;
    brands?: unknown;
    minPrice?: unknown;
    maxPrice?: unknown;
  },
): FilterQuery<typeof MasterProduct> {
  const clauses: FilterQuery<typeof MasterProduct>[] = [];

  if (query.search?.trim()) {
    const term = escapeRegex(query.search.trim());
    clauses.push({
      $or: [
        { name: { $regex: term, $options: 'i' } },
        { brand: { $regex: term, $options: 'i' } },
        { slug: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } },
      ],
    });
  }

  const brands = parseCsvQueryParam(query.brands);
  if (brands.length) {
    clauses.push({
      $or: brands.map((brand) => ({
        brand: { $regex: `^${escapeRegex(brand)}$`, $options: 'i' },
      })),
    });
  }

  const minPaise = parseRupeeBoundPaise(query.minPrice);
  const maxPaise = parseRupeeBoundPaise(query.maxPrice);
  if (minPaise != null || maxPaise != null) {
    const sellingPricePaise: Record<string, number> = {};
    if (minPaise != null) sellingPricePaise.$gte = minPaise;
    if (maxPaise != null) sellingPricePaise.$lte = maxPaise;
    clauses.push({ sellingPricePaise });
  }

  if (!clauses.length) return match;
  if (clauses.length === 1) return { ...match, ...clauses[0] };
  return { ...match, $and: clauses };
}

export async function fetchListedProductFacets(
  match: FilterQuery<typeof MasterProduct>,
): Promise<{
  brands: Array<{ label: string; count: number }>;
  priceCounts: Record<string, number>;
  typeCountsById: Map<string, number>;
}> {
  const listedMatch: FilterQuery<typeof MasterProduct> = { status: 'ACTIVE', ...match };

  const [brandRows, priceRows, typeRows] = await Promise.all([
    MasterProduct.aggregate<{ label: string; count: number }>([
      { $match: { ...listedMatch, brand: { $type: 'string' } } },
      listedProductLookupStage(),
      hasListedProductMatchStage(),
      {
        $group: {
          _id: { $toLower: { $trim: { input: '$brand' } } },
          label: { $first: { $trim: { input: '$brand' } } },
          count: { $sum: 1 },
        },
      },
      { $match: { _id: { $nin: [null, ''] } } },
      { $sort: { label: 1 } },
    ]),
    MasterProduct.aggregate<Record<string, number>>([
      { $match: listedMatch },
      listedProductLookupStage(),
      hasListedProductMatchStage(),
      {
        $group: {
          _id: null,
          ...Object.fromEntries(
            STOREFRONT_PRICE_BUCKETS.map((bucket) => [
              bucket.id,
              { $sum: { $cond: [priceBucketExpression(bucket), 1, 0] } },
            ]),
          ),
        },
      },
    ]),
    MasterProduct.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: listedMatch },
      listedProductLookupStage(),
      hasListedProductMatchStage(),
      {
        $group: {
          _id: '$productTypeId',
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const counts = priceRows[0] ?? {};
  const typeCountsById = new Map<string, number>();
  for (const row of typeRows) {
    if (!row._id) continue;
    typeCountsById.set(row._id.toString(), row.count);
  }

  return {
    brands: brandRows
      .map((row) => ({ label: row.label, count: row.count }))
      .filter((row) => Boolean(row.label) && row.count > 0),
    priceCounts: Object.fromEntries(
      STOREFRONT_PRICE_BUCKETS.map((bucket) => [bucket.id, Number(counts[bucket.id] ?? 0)]),
    ),
    typeCountsById,
  };
}

/** Related picks: same subcategory → same category → catalog (not gated on seller listings). */
export async function loadRelatedMasterProducts(
  product: {
    _id: Types.ObjectId;
    subcategoryId?: { _id?: Types.ObjectId; slug?: string } | Types.ObjectId;
    categoryId?: { _id?: Types.ObjectId; slug?: string } | Types.ObjectId;
  },
  candidateLimit = 24,
): Promise<StorefrontMasterProductRow[]> {
  const excludeId = product._id;
  const subcategoryId =
    product.subcategoryId && typeof product.subcategoryId === 'object' && '_id' in product.subcategoryId
      ? product.subcategoryId._id
      : product.subcategoryId;
  const categoryId =
    product.categoryId && typeof product.categoryId === 'object' && '_id' in product.categoryId
      ? product.categoryId._id
      : product.categoryId;

  const collected: StorefrontMasterProductRow[] = [];
  const seen = new Set<string>([excludeId.toString()]);

  const append = (rows: StorefrontMasterProductRow[]) => {
    for (const row of rows) {
      const id = row._id.toString();
      if (seen.has(id)) continue;
      seen.add(id);
      collected.push(row);
      if (collected.length >= candidateLimit) break;
    }
  };

  const baseSelect = STOREFRONT_PRODUCT_SELECT;
  const slugPopulate = [
    { path: 'subcategoryId', select: 'slug' },
    { path: 'categoryId', select: 'slug' },
  ];

  if (subcategoryId) {
    const rows = await MasterProduct.find({
      status: 'ACTIVE',
      _id: { $ne: excludeId },
      subcategoryId,
    })
      .select(baseSelect)
      .populate(slugPopulate)
      .sort({ createdAt: -1 })
      .limit(candidateLimit)
      .lean();
    append(rows as StorefrontMasterProductRow[]);
  }

  if (collected.length < candidateLimit && categoryId) {
    const rows = await MasterProduct.find({
      status: 'ACTIVE',
      _id: { $ne: excludeId },
      categoryId,
    })
      .select(baseSelect)
      .populate(slugPopulate)
      .sort({ createdAt: -1 })
      .limit(candidateLimit)
      .lean();
    append(rows as StorefrontMasterProductRow[]);
  }

  if (collected.length < candidateLimit) {
    const rows = await MasterProduct.find({
      status: 'ACTIVE',
      _id: { $ne: excludeId },
    })
      .select(baseSelect)
      .populate(slugPopulate)
      .sort({ createdAt: -1 })
      .limit(candidateLimit)
      .lean();
    append(rows as StorefrontMasterProductRow[]);
  }

  return collected;
}

/** Batch-load slug maps for lean MasterProduct rows (cart/wishlist enrichment). */
export async function attachCategorySlugs<
  T extends {
    subcategoryId?: Types.ObjectId | { slug?: string };
    categoryId?: Types.ObjectId | { slug?: string };
  },
>(products: T[]): Promise<
  Array<
    T & {
      subcategoryId?: { slug?: string } | Types.ObjectId;
      categoryId?: { slug?: string } | Types.ObjectId;
    }
  >
> {
  const subIds = new Set<string>();
  const catIds = new Set<string>();
  for (const product of products) {
    if (product.subcategoryId && !('slug' in (product.subcategoryId as object))) {
      subIds.add(String(product.subcategoryId));
    }
    if (product.categoryId && !('slug' in (product.categoryId as object))) {
      catIds.add(String(product.categoryId));
    }
  }

  const [subs, cats] = await Promise.all([
    subIds.size
      ? Subcategory.find({ _id: { $in: [...subIds] } })
          .select('_id slug')
          .lean()
      : Promise.resolve([]),
    catIds.size
      ? Category.find({ _id: { $in: [...catIds] } })
          .select('_id slug')
          .lean()
      : Promise.resolve([]),
  ]);

  const subById = new Map(subs.map((s) => [String(s._id), s]));
  const catById = new Map(cats.map((c) => [String(c._id), c]));

  return products.map((product) => ({
    ...product,
    subcategoryId:
      product.subcategoryId && !('slug' in (product.subcategoryId as object))
        ? subById.get(String(product.subcategoryId)) ?? product.subcategoryId
        : product.subcategoryId,
    categoryId:
      product.categoryId && !('slug' in (product.categoryId as object))
        ? catById.get(String(product.categoryId)) ?? product.categoryId
        : product.categoryId,
  }));
}

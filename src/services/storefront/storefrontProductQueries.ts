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
  'name slug brand description sellingPricePaise attributes subcategoryId categoryId createdAt';

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
};

const SUBCATEGORY_COLLECTION = () => Subcategory.collection.name;
const CATEGORY_COLLECTION = () => Category.collection.name;

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
      $project: {
        _id: 1,
        name: 1,
        slug: 1,
        brand: 1,
        description: 1,
        sellingPricePaise: 1,
        attributes: 1,
        createdAt: 1,
        subcategoryId: { $arrayElemAt: ['$_subcategory', 0] },
        categoryId: { $arrayElemAt: ['$_category', 0] },
      },
    },
  ];
}

/** Listed storefront products — DB-level filter, sort, and limit (no distinct + $in). */
export async function fetchListedMasterProducts(
  extraMatch: FilterQuery<typeof MasterProduct>,
  limit: number,
): Promise<StorefrontMasterProductRow[]> {
  const pipeline: PipelineStage[] = [
    { $match: { status: 'ACTIVE', ...extraMatch } },
    listedProductLookupStage(),
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
): Promise<ListedProductsPageResult> {
  const basePipeline: PipelineStage[] = [
    { $match: { status: 'ACTIVE', ...extraMatch } },
    listedProductLookupStage(),
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

  if (query.productTypeSlug?.trim()) {
    const productType = await ProductType.findOne({
      slug: query.productTypeSlug.trim(),
      status: 'ACTIVE',
    })
      .select('_id')
      .lean();
    if (!productType) return { match, empty: true };
    match.productTypeId = productType._id;
  }

  return { match, empty: false };
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

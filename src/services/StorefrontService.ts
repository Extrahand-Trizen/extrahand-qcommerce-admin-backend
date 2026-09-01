import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import MasterProduct from '../models/MasterProduct';
import ProductImage from '../models/ProductImage';
import SellerListing from '../models/SellerListing';
import Attribute from '../models/Attribute';
import { AppError } from '../utils/response';
import { FilterQuery, Types } from 'mongoose';
import { resolvePublicAssetUrl } from '../utils/media';

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
  categories: Array<{ id: string; label: string; imageUrl: string }>;
  bestsellers: StoreProduct[];
  freshPicks: StoreProduct[];
  popular: StoreProduct[];
  recommended: StoreProduct[];
};

async function buildAttributeKeyMap() {
  const attrs = await Attribute.find({ isActive: true }).select('_id key');
  return new Map(attrs.map((a) => [a._id.toString(), a.key]));
}

function readAttributeValue(
  attributes: Array<{ attributeId: Types.ObjectId; value: unknown }>,
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
  attributes: Array<{ attributeId: Types.ObjectId; value: unknown }>,
  keyMap: Map<string, string>,
): string {
  const netQuantity = readAttributeValue(attributes, keyMap, 'net_quantity');
  const unit = readAttributeValue(attributes, keyMap, 'unit');
  if (netQuantity && unit) return `${netQuantity} ${unit}`;

  const legacyWeight = readAttributeValue(attributes, keyMap, 'weight');
  if (legacyWeight) return legacyWeight;

  return readAttributeValue(attributes, keyMap, 'sold_as') || '1 pc';
}

async function loadListingPrices(productIds: Types.ObjectId[]) {
  if (!productIds.length) return new Map<string, { price: number; mrp?: number }>();

  const listings = await SellerListing.find({
    masterProductId: { $in: productIds },
    status: 'ACTIVE',
    availability: 'AVAILABLE',
  }).sort({ sellingPrice: 1 });

  const priceMap = new Map<string, { price: number; mrp?: number }>();
  for (const listing of listings) {
    const id = listing.masterProductId.toString();
    if (!priceMap.has(id)) {
      priceMap.set(id, {
        price: listing.sellingPrice,
        mrp: listing.compareAtPrice,
      });
    }
  }
  return priceMap;
}

async function mapProductsToStore(
  products: Array<{
    _id: Types.ObjectId;
    name: string;
    slug: string;
    brand?: string;
    description?: string;
    attributes: Array<{ attributeId: Types.ObjectId; value: unknown }>;
    subcategoryId?: { slug?: string } | Types.ObjectId;
    categoryId?: { slug?: string } | Types.ObjectId;
  }>,
  imageMap: Map<string, string>,
  priceMap: Map<string, { price: number; mrp?: number }>,
  keyMap: Map<string, string>,
): Promise<StoreProduct[]> {
  return products
    .map((product) => {
      const id = product._id.toString();
      const pricing = priceMap.get(id);
      const imageUrl = imageMap.get(id);
      if (!pricing || !imageUrl) return null;

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
        price: pricing.price,
        mrp: pricing.mrp,
        imageUrl: resolvePublicAssetUrl(imageUrl),
        brand: product.brand,
        description: product.description,
        subcategorySlug: subcategory,
        categorySlug: category,
      } satisfies StoreProduct;
    })
    .filter((p): p is StoreProduct => p !== null);
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
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const filter: FilterQuery<typeof MasterProduct> = { status: 'ACTIVE' };

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

    const total = await MasterProduct.countDocuments(filter);
    const products = await MasterProduct.find(filter)
      .populate('subcategoryId', 'slug')
      .populate('categoryId', 'slug')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const productIds = products.map((p) => p._id);
    const [imageMap, priceMap, keyMap] = await Promise.all([
      loadProductImages(productIds),
      loadListingPrices(productIds),
      buildAttributeKeyMap(),
    ]);

    const items = await mapProductsToStore(products, imageMap, priceMap, keyMap);
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  static async getProductBySlug(slug: string) {
    const product = await MasterProduct.findOne({ slug, status: 'ACTIVE' })
      .populate('subcategoryId', 'slug name')
      .populate('categoryId', 'slug name');

    if (!product) throw new AppError('Product not found', 404);

    const images = await ProductImage.find({ masterProductId: product._id }).sort({ displayOrder: 1 });
    const [priceMap, keyMap] = await Promise.all([
      loadListingPrices([product._id]),
      buildAttributeKeyMap(),
    ]);
    const pricing = priceMap.get(product._id.toString());
    if (!pricing) throw new AppError('Product is not available for purchase', 404);

    const primaryImage = images.find((img) => img.isPrimary) || images[0];
    const unit = resolveProductUnit(product.attributes, keyMap);

    const storeProduct: StoreProduct = {
      id: product.slug,
      name: product.name,
      unit,
      price: pricing.price,
      mrp: pricing.mrp,
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
    };

    const relatedFilter: FilterQuery<typeof MasterProduct> = {
      status: 'ACTIVE',
      _id: { $ne: product._id },
    };
    if (product.subcategoryId) {
      relatedFilter.subcategoryId =
        typeof product.subcategoryId === 'object' && '_id' in product.subcategoryId
          ? product.subcategoryId._id
          : product.subcategoryId;
    }

    const relatedProducts = await MasterProduct.find(relatedFilter)
      .populate('subcategoryId', 'slug')
      .populate('categoryId', 'slug')
      .limit(8);

    const relatedIds = relatedProducts.map((p) => p._id);
    const [relatedImageMap, relatedPriceMap] = await Promise.all([
      loadProductImages(relatedIds),
      loadListingPrices(relatedIds),
    ]);
    const related = await mapProductsToStore(relatedProducts, relatedImageMap, relatedPriceMap, keyMap);

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
      related,
      similar: related.slice(0, 4),
    };
  }

  static async getHome() {
    const [groups, keyMap] = await Promise.all([
      this.getCategoryGroups(),
      buildAttributeKeyMap(),
    ]);

    const categories = groups.slice(0, 8).map((group) => ({
      id: group.id,
      label: group.title,
      imageUrl: resolvePublicAssetUrl(group.imageUrl),
    }));

    const loadSection = async (filter: FilterQuery<typeof MasterProduct>, limit = 10) => {
      const products = await MasterProduct.find({ status: 'ACTIVE', ...filter })
        .populate('subcategoryId', 'slug')
        .populate('categoryId', 'slug')
        .sort({ createdAt: -1 })
        .limit(limit);
      const productIds = products.map((p) => p._id);
      const [imageMap, priceMap] = await Promise.all([
        loadProductImages(productIds),
        loadListingPrices(productIds),
      ]);
      return mapProductsToStore(products, imageMap, priceMap, keyMap);
    };

    const fruitsVeg = await Subcategory.findOne({ slug: 'fruits-veg', status: 'ACTIVE' });

    const [bestsellers, freshPicks, popular, recommended] = await Promise.all([
      loadSection({}, 10),
      fruitsVeg ? loadSection({ subcategoryId: fruitsVeg._id }, 10) : loadSection({}, 10),
      loadSection({}, 8),
      loadSection({}, 8),
    ]);

    return {
      categories,
      bestsellers,
      freshPicks,
      popular,
      recommended,
    } satisfies StoreHomePayload;
  }
}

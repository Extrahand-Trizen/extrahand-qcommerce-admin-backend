import { FilterQuery, Types } from 'mongoose';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import MasterProduct from '../models/MasterProduct';
import ProductImage from '../models/ProductImage';
import ProductTypeAttribute from '../models/ProductTypeAttribute';
import Attribute from '../models/Attribute';
import SellerListing from '../models/SellerListing';
import ProductSubmission from '../models/ProductSubmission';
import { Availability } from '../types';
import { resolvePublicAssetUrl } from '../utils/media';
import { parsePagination } from '../utils/pagination';
import { PaginationQuery } from '../types';
import { AppError } from '../utils/response';

/* ------------------------------------------------------------------ */
/*  Shapes returned to the shopkeeper app                             */
/* ------------------------------------------------------------------ */

export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  displayOrder: number;
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
  sellingPricePaise: number;
  sellingPriceRupees: number;
  compareAtPricePaise?: number;
  compareAtPriceRupees?: number;
  availability: 'available' | 'limited' | 'out_of_stock';
  enabled: boolean;
  isCustomProduct?: boolean;
  reviewStatus?: 'approved' | 'pending_review';
}

export interface StoreCategorySummaryDTO {
  id: string;
  name: string;
  slug: string;
  displayOrder: number;
  productCount: number;
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

async function buildContext(products: Array<{ _id: unknown; productTypeId: unknown }>): Promise<CatalogueContext> {
  const productIds = products.map((p) => String(p._id));
  const typeIds = [...new Set(products.map((p) => String(p.productTypeId)))];

  const [cats, subs, attrs, ptAttrs, images] = await Promise.all([
    Category.find({}).select('name').lean(),
    Subcategory.find({}).select('name').lean(),
    Attribute.find({}).select('key').lean(),
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
      .select('name slug displayOrder')
      .sort({ displayOrder: 1, name: 1 })
      .lean();
    return cats.map((c) => ({
      id: String(c._id),
      name: c.name,
      slug: c.slug,
      displayOrder: c.displayOrder ?? 0,
    }));
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
    query: PaginationQuery & { categoryId?: string; availability?: string },
  ) {
    const { page, limit, skip } = parsePagination(query);

    const listingFilter: FilterQuery<typeof SellerListing> = { sellerId };
    if (query.availability) {
      const up = query.availability.toUpperCase();
      if (['AVAILABLE', 'LIMITED', 'OUT_OF_STOCK'].includes(up)) listingFilter.availability = up;
    }

    const listings = await SellerListing.find(listingFilter).sort({ updatedAt: -1 }).lean();

    let products = await MasterProduct.find({ _id: { $in: listings.map((l) => l.masterProductId) } })
      .select('name brand description categoryId subcategoryId productTypeId attributes sellingPricePaise')
      .lean();

    if (query.categoryId) {
      products = products.filter((p) => String(p.categoryId) === query.categoryId);
    }
    if (query.search?.trim()) {
      const q = query.search.trim().toLowerCase();
      products = products.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.brand ?? '').toLowerCase().includes(q),
      );
    }
    const productById = new Map(products.map((p) => [String(p._id), p]));
    const ctx = await buildContext(products);

    const customSubmissions = await ProductSubmission.find({
      sellerId,
      mappedMasterProductId: { $in: products.map((p) => p._id) },
    })
      .select('mappedMasterProductId status')
      .lean();
    const submissionByProduct = new Map(
      customSubmissions.map((s) => [String(s.mappedMasterProductId), s]),
    );

    const allItems: SellerListingItemDTO[] = listings
      .filter((l) => productById.has(String(l.masterProductId)))
      .map((l) => {
        const p = productById.get(String(l.masterProductId))!;
        const pid = String(p._id);
        const submission = submissionByProduct.get(pid);
        const isCustomProduct = Boolean(submission);

        const item: SellerListingItemDTO = {
          id: String(l._id),
          masterProductId: pid,
          name: p.name,
          brand: p.brand,
          categoryId: String(p.categoryId),
          categoryName: ctx.categoryName.get(String(p.categoryId)) ?? '',
          variant: buildVariant(p, ctx),
          imageUrl: ctx.primaryImage.get(pid) ?? '',
          description: p.description,
          sellingPricePaise: l.sellingPricePaise,
          sellingPriceRupees: toRupees(l.sellingPricePaise),
          availability: AVAILABILITY_OUT[l.availability as Availability] ?? 'available',
          enabled: l.status === 'ACTIVE',
          isCustomProduct,
          ...(isCustomProduct
            ? {
                reviewStatus:
                  l.reviewStatus === 'PENDING_REVIEW' || submission?.status === 'PENDING'
                    ? 'pending_review'
                    : 'approved',
              }
            : {}),
        };
        if (l.compareAtPricePaise != null) {
          item.compareAtPricePaise = l.compareAtPricePaise;
          item.compareAtPriceRupees = toRupees(l.compareAtPricePaise);
        }
        return item;
      });

    const total = allItems.length;
    const items = allItems.slice(skip, skip + limit);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
  }

  /** Categories that have at least one listing for this seller's store. */
  static async listStoreCategories(sellerId: string): Promise<StoreCategorySummaryDTO[]> {
    const listings = await SellerListing.find({ sellerId }).select('masterProductId').lean();
    if (!listings.length) return [];

    const productIds = listings.map((listing) => listing.masterProductId);
    const products = await MasterProduct.find({ _id: { $in: productIds } })
      .select('categoryId')
      .lean();

    const countByCategory = new Map<string, number>();
    for (const product of products) {
      const categoryId = String(product.categoryId);
      countByCategory.set(categoryId, (countByCategory.get(categoryId) ?? 0) + 1);
    }

    const categories = await Category.find({
      _id: { $in: [...countByCategory.keys()] },
      status: 'ACTIVE',
    })
      .select('name slug displayOrder')
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    return categories.map((category) => ({
      id: String(category._id),
      name: category.name,
      slug: category.slug,
      displayOrder: category.displayOrder ?? 0,
      productCount: countByCategory.get(String(category._id)) ?? 0,
    }));
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
    input: { masterProductId: string; sellingPricePaise?: number; availability?: string },
  ): Promise<SellerListingItemDTO> {
    const master = await MasterProduct.findById(input.masterProductId).select('sellingPricePaise status');
    if (!master || master.status !== 'ACTIVE') throw new AppError('Product not found in catalogue', 404);

    const existing = await SellerListing.findOne({ sellerId, masterProductId: input.masterProductId });
    if (existing) throw new AppError('Product already in your store', 409);

    const listing = await SellerListing.create({
      sellerId,
      masterProductId: input.masterProductId,
      sellingPricePaise:
        input.sellingPricePaise != null && input.sellingPricePaise >= 0
          ? Math.round(input.sellingPricePaise)
          : master.sellingPricePaise,
      availability: this.normalizeAvailability(input.availability) ?? 'AVAILABLE',
      status: 'ACTIVE',
      reviewStatus: 'APPROVED',
    });

    const one = await this.listMyListings(sellerId, { limit: 1000 });
    return one.items.find((i) => i.id === String(listing._id))!;
  }

  /** Add many at once. Skips products already in the store. */
  static async addListingsBulk(
    sellerId: string,
    body: {
      items: Array<{ masterProductId: string; sellingPricePaise?: number }>;
      defaults?: { availability?: string };
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
    const priceOverride = new Map(
      (body.items || []).map((i) => [i.masterProductId, i.sellingPricePaise]),
    );

    const docs = ids
      .filter((id) => masterById.has(id) && !alreadySet.has(id))
      .map((id) => {
        const override = priceOverride.get(id);
        return {
          sellerId,
          masterProductId: id,
          sellingPricePaise:
            override != null && override >= 0
              ? Math.round(override)
              : masterById.get(id)!.sellingPricePaise,
          availability,
          status: 'ACTIVE' as const,
          reviewStatus: 'APPROVED' as const,
        };
      });

    if (docs.length) await SellerListing.insertMany(docs, { ordered: false });

    const skipped = ids.length - docs.length;
    return { added: docs.length, skipped, requested: ids.length };
  }

  /** Update the seller's own listing (price / availability / on-off). */
  static async updateListing(
    sellerId: string,
    listingId: string,
    patch: { sellingPricePaise?: number; availability?: string; enabled?: boolean },
  ): Promise<SellerListingItemDTO> {
    const listing = await SellerListing.findById(listingId);
    if (!listing) throw new AppError('Listing not found', 404);
    if (String(listing.sellerId) !== sellerId) throw new AppError('Not your listing', 403);

    if (patch.sellingPricePaise != null) {
      if (patch.sellingPricePaise < 0) throw new AppError('Price must be >= 0', 400);
      listing.sellingPricePaise = Math.round(patch.sellingPricePaise);
    }
    const avail = this.normalizeAvailability(patch.availability);
    if (avail) listing.availability = avail;
    if (typeof patch.enabled === 'boolean') listing.status = patch.enabled ? 'ACTIVE' : 'INACTIVE';

    await listing.save();

    const all = await this.listMyListings(sellerId, { limit: 1000 });
    return all.items.find((i) => i.id === listingId)!;
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
    return { deleted: true };
  }

  /** Bulk hard-delete across the seller's own listings. Ids that aren't the
   *  seller's (or don't exist) are silently ignored. */
  static async deleteListingsBulk(sellerId: string, body: { ids: string[] }) {
    const ids = [...new Set(body.ids || [])];
    if (!ids.length) throw new AppError('No ids provided', 400);

    const result = await SellerListing.deleteMany({ _id: { $in: ids }, sellerId });
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

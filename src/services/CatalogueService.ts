import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import Attribute from '../models/Attribute';
import ProductTypeAttribute from '../models/ProductTypeAttribute';
import MasterProduct from '../models/MasterProduct';
import { slugify, uniqueSlug } from '../utils/slug';
import { paginate } from '../utils/pagination';
import { PaginationQuery } from '../types';
import { AppError } from '../utils/response';
import mongoose, { FilterQuery, SortOrder } from 'mongoose';
import { invalidateTaxonomyCache } from './SellerCatalogueService';
import {
  CATEGORY_PLATFORM_FEE_MAP,
  DEFAULT_PLATFORM_FEE_PERCENT,
  COMMISSION_GST_PERCENT,
  DEFAULT_SAC_CODE,
  DEFAULT_SAC_HEADING,
  setDynamicCategoryFee,
} from '../config/platformFees';

export class CatalogueService {
  // Categories
  static async listCategories(query: PaginationQuery & { status?: string; vertical?: string }) {
    const filter: FilterQuery<typeof Category> = {};
    if (query.status) filter.status = query.status;
    if (query.vertical && query.vertical !== 'all') {
      filter.vertical = query.vertical.toUpperCase();
    }
    if (query.search?.trim()) {
      const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: `^${escaped}|\\b${escaped}`, $options: 'i' } },
        { slug: { $regex: `^${escaped}`, $options: 'i' } },
      ];
    }
    return paginate(Category, filter, query);
  }

  static async getCategory(id: string) {
    const cat = await Category.findById(id);
    if (!cat) throw new AppError('Category not found', 404);
    return cat;
  }

  static async createCategory(data: Record<string, unknown>, userId?: string) {
    const slug = data.slug as string || await uniqueSlug(data.name as string, async (s) => !!(await Category.findOne({ slug: s })));
    const vertical = (data.vertical as string)?.toUpperCase() || 'KIRANA';
    const festival = typeof data.festival === 'string' ? data.festival.trim() : '';
    if (vertical === 'SEASONAL' && !festival) {
      throw new AppError('Festival / Occasion is required for Seasonal categories', 400);
    }
    const res = await Category.create({ ...data, slug, vertical, festival: festival || undefined, createdBy: userId, updatedBy: userId });
    if (res.slug && (res.platformFeePercent != null || res.gstPercent != null)) {
      setDynamicCategoryFee(res.slug, res.platformFeePercent, res.gstPercent);
    }
    invalidateTaxonomyCache();
    return res;
  }

  static async updateCategory(id: string, data: Record<string, unknown>, userId?: string) {
    const cat = await Category.findById(id);
    if (!cat) throw new AppError('Category not found', 404);
    if (data.name && !data.slug) data.slug = slugify(data.name as string);
    const vertical = typeof data.vertical === 'string' ? data.vertical.toUpperCase() : cat.vertical;
    const festival = typeof data.festival === 'string' ? data.festival.trim() : cat.festival?.trim();
    if (vertical === 'SEASONAL' && !festival) {
      throw new AppError('Festival / Occasion is required for Seasonal categories', 400);
    }
    data.vertical = vertical;
    data.festival = festival || undefined;
    Object.assign(cat, data, { updatedBy: userId });
    await cat.save();
    if (cat.slug && (cat.platformFeePercent != null || cat.gstPercent != null)) {
      setDynamicCategoryFee(cat.slug, cat.platformFeePercent, cat.gstPercent);
    }
    await Subcategory.updateMany({ categoryId: id }, { vertical });
    await ProductType.updateMany({ categoryId: id }, { vertical });
    invalidateTaxonomyCache();
    return cat;
  }

  static async deleteCategory(id: string) {
    const cat = await Category.findById(id);
    if (!cat) throw new AppError('Category not found', 404);
    const subCount = await Subcategory.countDocuments({ categoryId: id });
    if (subCount > 0) {
      throw new AppError(`Cannot delete: ${subCount} subcategory(ies) exist under this category`, 409);
    }
    const productCount = await MasterProduct.countDocuments({ categoryId: id });
    if (productCount > 0) {
      throw new AppError(`Cannot delete: ${productCount} product(s) exist under this category`, 409);
    }
    await Category.findByIdAndDelete(id);
    invalidateTaxonomyCache();
    return { deleted: true };
  }

  // Subcategories
  static async listSubcategories(query: PaginationQuery & { status?: string; categoryId?: string; vertical?: string }) {
    const filter: FilterQuery<typeof Subcategory> = {};
    if (query.status) filter.status = query.status;
    if (query.categoryId) filter.categoryId = query.categoryId;
    if (query.vertical && query.vertical !== 'all') {
      filter.vertical = query.vertical.toUpperCase();
    }
    if (query.search?.trim()) {
      const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: `^${escaped}|\\b${escaped}`, $options: 'i' } },
        { slug: { $regex: `^${escaped}`, $options: 'i' } },
      ];
    }
    return paginate(Subcategory, filter, query, 'categoryId');
  }

  static async getSubcategory(id: string) {
    const sub = await Subcategory.findById(id).populate('categoryId');
    if (!sub) throw new AppError('Subcategory not found', 404);
    return sub;
  }

  static async createSubcategory(data: Record<string, unknown>, userId?: string) {
    const category = await Category.findById(data.categoryId);
    if (!category) throw new AppError('Category not found', 404);
    if (category.status === 'INACTIVE' && data.status !== 'INACTIVE') {
      throw new AppError('Cannot create active subcategory under inactive category', 400);
    }
    const vertical = category.vertical || 'KIRANA';
    const slug = data.slug as string || await uniqueSlug(data.name as string, async (s) => !!(await Subcategory.findOne({ slug: s })));
    const platformFeePercent =
      data.platformFeePercent !== undefined && data.platformFeePercent !== '' && data.platformFeePercent !== null
        ? Number(data.platformFeePercent)
        : category.platformFeePercent;
    const gstPercent =
      data.gstPercent !== undefined && data.gstPercent !== '' && data.gstPercent !== null
        ? Number(data.gstPercent)
        : (category.gstPercent ?? 18);

    const res = await Subcategory.create({
      ...data,
      platformFeePercent,
      gstPercent,
      slug,
      vertical,
      createdBy: userId,
      updatedBy: userId,
    });
    if (res.slug && (res.platformFeePercent != null || res.gstPercent != null)) {
      setDynamicCategoryFee(res.slug, res.platformFeePercent, res.gstPercent);
    }
    invalidateTaxonomyCache();
    return res;
  }

  static async updateSubcategory(id: string, data: Record<string, unknown>, userId?: string) {
    const sub = await Subcategory.findById(id);
    if (!sub) throw new AppError('Subcategory not found', 404);
    if (data.status === 'ACTIVE') {
      const category = await Category.findById(sub.categoryId);
      if (category?.status === 'INACTIVE') throw new AppError('Cannot activate subcategory under inactive category', 400);
    }
    const categoryId = String(data.categoryId || sub.categoryId);
    const category = await Category.findById(categoryId).select('vertical status').lean();
    if (!category) throw new AppError('Category not found', 404);
    if (category.status === 'INACTIVE' && data.status !== 'INACTIVE') {
      throw new AppError('Cannot activate subcategory under inactive category', 400);
    }
    data.vertical = category.vertical || 'KIRANA';
    Object.assign(sub, data, { updatedBy: userId });
    await sub.save();
    if (sub.slug && (sub.platformFeePercent != null || sub.gstPercent != null)) {
      setDynamicCategoryFee(sub.slug, sub.platformFeePercent, sub.gstPercent);
    }
    await ProductType.updateMany(
      { subcategoryId: id },
      { categoryId, vertical: category.vertical || 'KIRANA' },
    );
    invalidateTaxonomyCache();
    return sub;
  }

  static async deleteSubcategory(id: string) {
    const sub = await Subcategory.findById(id);
    if (!sub) throw new AppError('Subcategory not found', 404);
    const typeCount = await ProductType.countDocuments({ subcategoryId: id });
    if (typeCount > 0) {
      throw new AppError(`Cannot delete: ${typeCount} product type(s) exist under this subcategory`, 409);
    }
    const productCount = await MasterProduct.countDocuments({ subcategoryId: id });
    if (productCount > 0) {
      throw new AppError(`Cannot delete: ${productCount} product(s) exist under this subcategory`, 409);
    }
    await Subcategory.findByIdAndDelete(id);
    invalidateTaxonomyCache();
    return { deleted: true };
  }

  // Product Types
  static async listProductTypes(query: PaginationQuery & { status?: string; categoryId?: string; subcategoryId?: string; vertical?: string }) {
    const filter: FilterQuery<typeof ProductType> = {};
    if (query.status) filter.status = query.status;
    if (query.categoryId) filter.categoryId = query.categoryId;
    if (query.subcategoryId) filter.subcategoryId = query.subcategoryId;
    if (query.vertical && query.vertical !== 'all') {
      filter.vertical = query.vertical.toUpperCase();
    }
    if (query.search?.trim()) {
      const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: `^${escaped}|\\b${escaped}`, $options: 'i' } },
        { slug: { $regex: `^${escaped}`, $options: 'i' } },
      ];
    }
    const result = await paginate(ProductType, filter, query, ['categoryId', 'subcategoryId']);
    if (
      result.items.length === 0 &&
      query.subcategoryId &&
      !query.search &&
      mongoose.Types.ObjectId.isValid(query.subcategoryId)
    ) {
      const sub = await Subcategory.findById(query.subcategoryId).select('categoryId name slug vertical').lean();
      if (sub) {
        const fallbackSlug = `${sub.slug || 'item'}-general`;
        await ProductType.findOneAndUpdate(
          { subcategoryId: query.subcategoryId, slug: fallbackSlug },
          {
            $setOnInsert: {
              subcategoryId: query.subcategoryId,
              categoryId: sub.categoryId,
              vertical: (sub as any).vertical || 'KIRANA',
              name: sub.name,
              slug: fallbackSlug,
              status: 'ACTIVE',
              displayOrder: 0,
            },
          },
          { upsert: true, new: true }
        ).lean();
        return paginate(ProductType, filter, query, ['categoryId', 'subcategoryId']);
      }
    }
    return result;
  }

  static async getProductType(id: string) {
    const pt = await ProductType.findById(id).populate(['categoryId', 'subcategoryId']);
    if (!pt) throw new AppError('Product type not found', 404);
    return pt;
  }

  static async createProductType(data: Record<string, unknown>, userId?: string) {
    const sub = await Subcategory.findById(data.subcategoryId);
    if (!sub) throw new AppError('Subcategory not found', 404);
    if (sub.categoryId.toString() !== data.categoryId) {
      throw new AppError('Subcategory does not belong to the selected category', 400);
    }
    const vertical = sub.vertical || 'KIRANA';
    const slug = data.slug as string || await uniqueSlug(data.name as string, async (s) => !!(await ProductType.findOne({ slug: s })));
    const productType = await ProductType.create({ ...data, slug, vertical, createdBy: userId, updatedBy: userId });
    invalidateTaxonomyCache();
    return productType;
  }

  static async updateProductType(id: string, data: Record<string, unknown>, userId?: string) {
    const pt = await ProductType.findById(id);
    if (!pt) throw new AppError('Product type not found', 404);
    const subcategoryId = String(data.subcategoryId || pt.subcategoryId);
    const sub = await Subcategory.findById(subcategoryId).select('categoryId vertical status').lean();
    if (!sub) throw new AppError('Subcategory not found', 404);
    const categoryId = String(data.categoryId || pt.categoryId);
    if (sub.categoryId.toString() !== categoryId) {
      throw new AppError('Subcategory does not belong to the selected category', 400);
    }
    data.vertical = sub.vertical || 'KIRANA';
    Object.assign(pt, data, { updatedBy: userId });
    await pt.save();
    invalidateTaxonomyCache();
    return pt;
  }

  static async deleteProductType(id: string) {
    const pt = await ProductType.findById(id);
    if (!pt) throw new AppError('Product type not found', 404);
    const productCount = await MasterProduct.countDocuments({ productTypeId: id });
    if (productCount > 0) {
      throw new AppError(`Cannot delete: ${productCount} product(s) use this product type`, 409);
    }
    await ProductTypeAttribute.deleteMany({ productTypeId: id });
    await ProductType.findByIdAndDelete(id);
    invalidateTaxonomyCache();
    return { deleted: true };
  }

  // Attributes
  static async listAttributes(query: PaginationQuery & { isActive?: string }) {
    const filter: FilterQuery<typeof Attribute> = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
    if (query.search) filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { key: { $regex: query.search, $options: 'i' } },
    ];
    return paginate(Attribute, filter, query);
  }

  static async getAttribute(id: string) {
    const attr = await Attribute.findById(id);
    if (!attr) throw new AppError('Attribute not found', 404);
    return attr;
  }

  static async createAttribute(data: Record<string, unknown>, userId?: string) {
    if (!data.key) data.key = slugify(data.name as string).replace(/-/g, '_');
    const res = await Attribute.create({ ...data, createdBy: userId, updatedBy: userId });
    invalidateTaxonomyCache();
    return res;
  }

  static async updateAttribute(id: string, data: Record<string, unknown>, userId?: string) {
    const attr = await Attribute.findById(id);
    if (!attr) throw new AppError('Attribute not found', 404);
    Object.assign(attr, data, { updatedBy: userId });
    await attr.save();
    invalidateTaxonomyCache();
    return attr;
  }

  static async deleteAttribute(id: string) {
    const attr = await Attribute.findById(id);
    if (!attr) throw new AppError('Attribute not found', 404);
    const mappingCount = await ProductTypeAttribute.countDocuments({ attributeId: id });
    if (mappingCount > 0) {
      throw new AppError(`Cannot delete: attribute is linked to ${mappingCount} product type(s)`, 409);
    }
    await Attribute.findByIdAndDelete(id);
    invalidateTaxonomyCache();
    return { deleted: true };
  }

  // Product Type Attributes
  static async listProductTypeAttributes(productTypeId: string) {
    return ProductTypeAttribute.find({ productTypeId })
      .populate('attributeId')
      .sort({ displayOrder: 1 });
  }

  static async setProductTypeAttributes(
    productTypeId: string,
    mappings: Array<{ attributeId: string; isRequired?: boolean; displayOrder?: number; defaultValue?: string }>
  ) {
    await ProductTypeAttribute.deleteMany({ productTypeId });
    if (mappings.length === 0) return [];
    const docs = mappings.map((m, i) => ({
      productTypeId,
      attributeId: m.attributeId,
      isRequired: m.isRequired ?? false,
      displayOrder: m.displayOrder ?? i,
      defaultValue: m.defaultValue,
    }));
    return ProductTypeAttribute.insertMany(docs);
  }

  /**
   * List categories & subcategories with pagination, MongoDB indexing, and fast fetching.
   */
  static async listCatalogueFees(query: {
    page?: number | string;
    limit?: number | string;
    search?: string;
    vertical?: string;
    type?: string;
    sortBy?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit =
      query.limit === 'all' || Number(query.limit) >= 500
        ? 500
        : Math.min(200, Math.max(1, Number(query.limit) || 50));
    const skip = (page - 1) * limit;
    const type = query.type ? query.type.toUpperCase() : 'ALL';

    // 1. When querying primary Categories (default & recommended)
    if (type === 'CATEGORY') {
      const filter: FilterQuery<typeof Category> = {};

      if (query.vertical && query.vertical !== 'all') {
        filter.vertical = query.vertical.toUpperCase();
      }

      if (query.search && query.search.trim()) {
        const s = query.search.trim();
        filter.$or = [
          { name: { $regex: s, $options: 'i' } },
          { slug: { $regex: s, $options: 'i' } },
        ];
      }

      // Fast indexed sort
      let sort: Record<string, SortOrder> = { displayOrder: 1, name: 1 };
      if (query.sortBy === 'fee-desc') sort = { platformFeePercent: -1, name: 1 };
      else if (query.sortBy === 'fee-asc') sort = { platformFeePercent: 1, name: 1 };
      else if (query.sortBy === 'updated') sort = { updatedAt: -1, _id: -1 };

      const [cats, total] = await Promise.all([
        Category.find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .select('_id name slug vertical displayOrder platformFeePercent gstPercent sacCode sacHeading updatedAt createdAt imageUrl status')
          .lean(),
        Category.countDocuments(filter),
      ]);

      // Targeted aggregation for subcategories covered only by the returned categories
      const catIds = cats.map((c) => c._id);
      const subcatCounts = await Subcategory.aggregate([
        { $match: { categoryId: { $in: catIds } } },
        {
          $group: {
            _id: '$categoryId',
            count: { $sum: 1 },
            sampleNames: { $push: '$name' },
          },
        },
      ]);
      const subcatMap = new Map(subcatCounts.map((sc) => [sc._id.toString(), sc]));

      const items = cats.map((c: any) => {
        const defaultFee = CATEGORY_PLATFORM_FEE_MAP[c.slug] ?? DEFAULT_PLATFORM_FEE_PERCENT;
        const scInfo = subcatMap.get(c._id.toString());
        const count = scInfo ? scInfo.count : 0;
        const sample = scInfo?.sampleNames || [];
        const summary =
          sample.length > 0
            ? sample.slice(0, 3).join(', ') + (sample.length > 3 ? ` +${sample.length - 3} more` : '')
            : undefined;

        return {
          _id: c._id.toString(),
          name: c.name,
          slug: c.slug,
          type: 'CATEGORY' as const,
          vertical: c.vertical || 'KIRANA',
          platformFeePercent: c.platformFeePercent != null ? c.platformFeePercent : defaultFee,
          gstPercent: c.gstPercent != null ? c.gstPercent : COMMISSION_GST_PERCENT,
          sacCode: c.sacCode || DEFAULT_SAC_CODE,
          sacHeading: c.sacHeading || DEFAULT_SAC_HEADING,
          isCustom: c.platformFeePercent != null,
          status: c.status || 'ACTIVE',
          imageUrl: c.imageUrl,
          subcategoriesCount: count,
          subcategoriesSummary: summary,
          updatedAt: c.updatedAt || c.createdAt || new Date(),
          updatedBy: c.updatedBy,
        };
      });

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        defaultPlatformFeePercent: DEFAULT_PLATFORM_FEE_PERCENT,
        defaultGstPercent: COMMISSION_GST_PERCENT,
        defaultSacCode: DEFAULT_SAC_CODE,
        defaultSacHeading: DEFAULT_SAC_HEADING,
      };
    }

    // 2. When querying Subcategories only
    if (type === 'SUBCATEGORY') {
      const filter: FilterQuery<typeof Subcategory> = {};
      if (query.vertical && query.vertical !== 'all') {
        filter.vertical = query.vertical.toUpperCase();
      }
      if (query.search && query.search.trim()) {
        const s = query.search.trim();
        filter.$or = [
          { name: { $regex: s, $options: 'i' } },
          { slug: { $regex: s, $options: 'i' } },
        ];
      }

      let sort: Record<string, SortOrder> = { displayOrder: 1, name: 1 };
      if (query.sortBy === 'fee-desc') sort = { platformFeePercent: -1, name: 1 };
      else if (query.sortBy === 'fee-asc') sort = { platformFeePercent: 1, name: 1 };
      else if (query.sortBy === 'updated') sort = { updatedAt: -1, _id: -1 };

      const [subcats, total, allCats] = await Promise.all([
        Subcategory.find(filter)
          .populate('categoryId', 'name sacCode sacHeading')
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .select('_id categoryId name slug vertical displayOrder platformFeePercent gstPercent sacCode sacHeading updatedAt createdAt imageUrl status')
          .lean(),
        Subcategory.countDocuments(filter),
        Category.find({}).select('_id name sacCode sacHeading').lean(),
      ]);

      const catMap = new Map((allCats as any[]).map((c) => [c._id.toString(), c]));

      const items = subcats.map((s: any) => {
        const defaultFee = CATEGORY_PLATFORM_FEE_MAP[s.slug] ?? DEFAULT_PLATFORM_FEE_PERCENT;
        const parentCat = (s.categoryId as any) || catMap.get(s.categoryId?.toString?.() || '');
        const parentName = parentCat?.name || undefined;
        const sacCode = s.sacCode || parentCat?.sacCode || DEFAULT_SAC_CODE;
        const sacHeading = s.sacHeading || parentCat?.sacHeading || DEFAULT_SAC_HEADING;

        return {
          _id: s._id.toString(),
          name: s.name,
          slug: s.slug,
          type: 'SUBCATEGORY' as const,
          parentName,
          vertical: s.vertical || 'KIRANA',
          platformFeePercent: s.platformFeePercent != null ? s.platformFeePercent : defaultFee,
          gstPercent: s.gstPercent != null ? s.gstPercent : COMMISSION_GST_PERCENT,
          sacCode,
          sacHeading,
          isCustom: s.platformFeePercent != null,
          status: s.status || 'ACTIVE',
          imageUrl: s.imageUrl,
          updatedAt: s.updatedAt || s.createdAt || new Date(),
          updatedBy: s.updatedBy,
        };
      });

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        defaultPlatformFeePercent: DEFAULT_PLATFORM_FEE_PERCENT,
        defaultGstPercent: COMMISSION_GST_PERCENT,
        defaultSacCode: DEFAULT_SAC_CODE,
        defaultSacHeading: DEFAULT_SAC_HEADING,
      };
    }

    // 3. Fallback: Combined Categories & Subcategories
    const [cats, subcats] = await Promise.all([
      Category.find({}).select('_id name slug vertical platformFeePercent gstPercent sacCode sacHeading updatedAt createdAt imageUrl status').lean(),
      Subcategory.find({}).populate('categoryId', 'name sacCode sacHeading').select('_id categoryId name slug vertical platformFeePercent gstPercent sacCode sacHeading updatedAt createdAt imageUrl status').lean(),
    ]);

    const catMap = new Map((cats as any[]).map((c) => [c._id.toString(), c]));

    let combined: any[] = [];
    for (const c of cats as any[]) {
      const defaultFee = CATEGORY_PLATFORM_FEE_MAP[c.slug] ?? DEFAULT_PLATFORM_FEE_PERCENT;
      combined.push({
        _id: c._id.toString(),
        name: c.name,
        slug: c.slug,
        type: 'CATEGORY',
        vertical: c.vertical || 'KIRANA',
        platformFeePercent: c.platformFeePercent != null ? c.platformFeePercent : defaultFee,
        gstPercent: c.gstPercent != null ? c.gstPercent : COMMISSION_GST_PERCENT,
        sacCode: c.sacCode || DEFAULT_SAC_CODE,
        sacHeading: c.sacHeading || DEFAULT_SAC_HEADING,
        isCustom: c.platformFeePercent != null,
        status: c.status || 'ACTIVE',
        imageUrl: c.imageUrl,
        updatedAt: c.updatedAt || c.createdAt || new Date(),
        updatedBy: c.updatedBy,
      });
    }

    for (const s of subcats as any[]) {
      const defaultFee = CATEGORY_PLATFORM_FEE_MAP[s.slug] ?? DEFAULT_PLATFORM_FEE_PERCENT;
      const parentCat = (s.categoryId as any) || catMap.get(s.categoryId?.toString?.() || '');
      const parentName = parentCat?.name || undefined;
      const sacCode = s.sacCode || parentCat?.sacCode || DEFAULT_SAC_CODE;
      const sacHeading = s.sacHeading || parentCat?.sacHeading || DEFAULT_SAC_HEADING;

      combined.push({
        _id: s._id.toString(),
        name: s.name,
        slug: s.slug,
        type: 'SUBCATEGORY',
        parentName,
        vertical: s.vertical || 'KIRANA',
        platformFeePercent: s.platformFeePercent != null ? s.platformFeePercent : defaultFee,
        gstPercent: s.gstPercent != null ? s.gstPercent : COMMISSION_GST_PERCENT,
        sacCode,
        sacHeading,
        isCustom: s.platformFeePercent != null,
        status: s.status || 'ACTIVE',
        imageUrl: s.imageUrl,
        updatedAt: s.updatedAt || s.createdAt || new Date(),
        updatedBy: s.updatedBy,
      });
    }

    if (query.vertical && query.vertical !== 'all') {
      combined = combined.filter((it) => it.vertical.toUpperCase() === query.vertical?.toUpperCase());
    }

    if (query.search && query.search.trim()) {
      const s = query.search.toLowerCase().trim();
      combined = combined.filter(
        (it) =>
          it.name.toLowerCase().includes(s) ||
          it.slug.toLowerCase().includes(s) ||
          (it.parentName && it.parentName.toLowerCase().includes(s))
      );
    }

    if (query.sortBy === 'fee-desc') {
      combined.sort((a, b) => b.platformFeePercent - a.platformFeePercent);
    } else if (query.sortBy === 'fee-asc') {
      combined.sort((a, b) => a.platformFeePercent - b.platformFeePercent);
    } else if (query.sortBy === 'updated') {
      combined.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } else {
      combined.sort((a, b) => a.name.localeCompare(b.name));
    }

    const total = combined.length;
    const paginatedItems = combined.slice(skip, skip + limit);

    return {
      items: paginatedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      defaultPlatformFeePercent: DEFAULT_PLATFORM_FEE_PERCENT,
      defaultGstPercent: COMMISSION_GST_PERCENT,
    };
  }

  /**
   * Update fee & GST % for a category or subcategory and update the in-memory cache live.
   */
  static async updateCatalogueFee(
    id: string,
    data: {
      type: 'CATEGORY' | 'SUBCATEGORY';
      platformFeePercent: number;
      gstPercent?: number;
      sacCode?: string;
      sacHeading?: string;
    },
    userId?: string,
  ) {
    const fee = Math.max(0, Math.min(100, Number(data.platformFeePercent) || 0));
    const gst = data.gstPercent != null ? Math.max(0, Math.min(100, Number(data.gstPercent) || 0)) : 18;

    if (data.type === 'CATEGORY') {
      const cat = await Category.findById(id);
      if (!cat) throw new AppError('Category not found', 404);
      cat.platformFeePercent = fee;
      cat.gstPercent = gst;
      if (data.sacCode !== undefined) {
        cat.sacCode = data.sacCode.trim() || DEFAULT_SAC_CODE;
      }
      if (data.sacHeading !== undefined) {
        cat.sacHeading = data.sacHeading.trim() || DEFAULT_SAC_HEADING;
      }
      cat.updatedBy = userId;
      await cat.save();

      // Automatically propagate fee, gst, sacCode, sacHeading to child subcategories
      const subcatUpdate: Record<string, any> = { platformFeePercent: fee, gstPercent: gst };
      if (data.sacCode !== undefined) subcatUpdate.sacCode = cat.sacCode;
      if (data.sacHeading !== undefined) subcatUpdate.sacHeading = cat.sacHeading;

      const subcats = await Subcategory.find({ categoryId: cat._id }).select('slug');
      await Subcategory.updateMany({ categoryId: cat._id }, subcatUpdate);

      // Update in-memory live fee cache for category slug and all its subcategory slugs
      setDynamicCategoryFee(cat.slug, fee, gst, cat.sacCode, cat.sacHeading);
      for (const s of subcats) {
        if (s.slug) {
          setDynamicCategoryFee(s.slug, fee, gst, cat.sacCode, cat.sacHeading);
        }
      }

      invalidateTaxonomyCache();

      return {
        _id: cat._id.toString(),
        name: cat.name,
        slug: cat.slug,
        type: 'CATEGORY',
        platformFeePercent: cat.platformFeePercent,
        gstPercent: cat.gstPercent,
        sacCode: cat.sacCode,
        sacHeading: cat.sacHeading,
        updatedAt: cat.updatedAt,
      };
    } else {
      const sub = await Subcategory.findById(id);
      if (!sub) throw new AppError('Subcategory not found', 404);
      sub.platformFeePercent = fee;
      sub.gstPercent = gst;
      if (data.sacCode !== undefined) {
        sub.sacCode = data.sacCode.trim() || undefined;
      }
      if (data.sacHeading !== undefined) {
        sub.sacHeading = data.sacHeading.trim() || undefined;
      }
      sub.updatedBy = userId;
      await sub.save();

      setDynamicCategoryFee(sub.slug, fee, gst, sub.sacCode, sub.sacHeading);
      invalidateTaxonomyCache();

      return {
        _id: sub._id.toString(),
        name: sub.name,
        slug: sub.slug,
        type: 'SUBCATEGORY',
        platformFeePercent: sub.platformFeePercent,
        gstPercent: sub.gstPercent,
        sacCode: sub.sacCode,
        sacHeading: sub.sacHeading,
        updatedAt: sub.updatedAt,
      };
    }
  }
}

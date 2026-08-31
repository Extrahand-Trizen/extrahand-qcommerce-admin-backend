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
import { FilterQuery } from 'mongoose';

export class CatalogueService {
  // Categories
  static async listCategories(query: PaginationQuery & { status?: string }) {
    const filter: FilterQuery<typeof Category> = {};
    if (query.status) filter.status = query.status;
    if (query.search) filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { slug: { $regex: query.search, $options: 'i' } },
    ];
    return paginate(Category, filter, query);
  }

  static async getCategory(id: string) {
    const cat = await Category.findById(id);
    if (!cat) throw new AppError('Category not found', 404);
    return cat;
  }

  static async createCategory(data: Record<string, unknown>, userId?: string) {
    const slug = data.slug as string || await uniqueSlug(data.name as string, async (s) => !!(await Category.findOne({ slug: s })));
    return Category.create({ ...data, slug, createdBy: userId, updatedBy: userId });
  }

  static async updateCategory(id: string, data: Record<string, unknown>, userId?: string) {
    const cat = await Category.findById(id);
    if (!cat) throw new AppError('Category not found', 404);
    if (data.name && !data.slug) data.slug = slugify(data.name as string);
    Object.assign(cat, data, { updatedBy: userId });
    await cat.save();
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
    return { deleted: true };
  }

  // Subcategories
  static async listSubcategories(query: PaginationQuery & { status?: string; categoryId?: string }) {
    const filter: FilterQuery<typeof Subcategory> = {};
    if (query.status) filter.status = query.status;
    if (query.categoryId) filter.categoryId = query.categoryId;
    if (query.search) filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { slug: { $regex: query.search, $options: 'i' } },
    ];
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
    const slug = data.slug as string || await uniqueSlug(data.name as string, async (s) => !!(await Subcategory.findOne({ slug: s })));
    return Subcategory.create({ ...data, slug, createdBy: userId, updatedBy: userId });
  }

  static async updateSubcategory(id: string, data: Record<string, unknown>, userId?: string) {
    const sub = await Subcategory.findById(id);
    if (!sub) throw new AppError('Subcategory not found', 404);
    if (data.status === 'ACTIVE') {
      const category = await Category.findById(sub.categoryId);
      if (category?.status === 'INACTIVE') throw new AppError('Cannot activate subcategory under inactive category', 400);
    }
    Object.assign(sub, data, { updatedBy: userId });
    await sub.save();
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
    return { deleted: true };
  }

  // Product Types
  static async listProductTypes(query: PaginationQuery & { status?: string; categoryId?: string; subcategoryId?: string }) {
    const filter: FilterQuery<typeof ProductType> = {};
    if (query.status) filter.status = query.status;
    if (query.categoryId) filter.categoryId = query.categoryId;
    if (query.subcategoryId) filter.subcategoryId = query.subcategoryId;
    if (query.search) filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { slug: { $regex: query.search, $options: 'i' } },
    ];
    return paginate(ProductType, filter, query, ['categoryId', 'subcategoryId']);
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
    const slug = data.slug as string || await uniqueSlug(data.name as string, async (s) => !!(await ProductType.findOne({ slug: s })));
    return ProductType.create({ ...data, slug, createdBy: userId, updatedBy: userId });
  }

  static async updateProductType(id: string, data: Record<string, unknown>, userId?: string) {
    const pt = await ProductType.findById(id);
    if (!pt) throw new AppError('Product type not found', 404);
    Object.assign(pt, data, { updatedBy: userId });
    await pt.save();
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
    return Attribute.create({ ...data, createdBy: userId, updatedBy: userId });
  }

  static async updateAttribute(id: string, data: Record<string, unknown>, userId?: string) {
    const attr = await Attribute.findById(id);
    if (!attr) throw new AppError('Attribute not found', 404);
    Object.assign(attr, data, { updatedBy: userId });
    await attr.save();
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
}

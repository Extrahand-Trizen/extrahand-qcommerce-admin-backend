import MasterProduct from '../models/MasterProduct';
import ProductImage from '../models/ProductImage';
import ProductTypeAttribute from '../models/ProductTypeAttribute';
import Attribute from '../models/Attribute';
import { uniqueSlug } from '../utils/slug';
import { paginate } from '../utils/pagination';
import { PaginationQuery, ProductAttributeValue } from '../types';
import { AppError } from '../utils/response';
import { FilterQuery } from 'mongoose';

function isValidGtin(gtin?: string): boolean {
  if (!gtin) return true;
  return /^\d{8,14}$/.test(gtin);
}

export class MasterProductService {
  static async list(query: PaginationQuery & {
    status?: string; categoryId?: string; subcategoryId?: string; productTypeId?: string;
  }) {
    const filter: FilterQuery<typeof MasterProduct> = {};
    if (query.status) filter.status = query.status;
    if (query.categoryId) filter.categoryId = query.categoryId;
    if (query.subcategoryId) filter.subcategoryId = query.subcategoryId;
    if (query.productTypeId) filter.productTypeId = query.productTypeId;
    if (query.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { brand: { $regex: query.search, $options: 'i' } },
        { sku: { $regex: query.search, $options: 'i' } },
      ];
    }
    const result = await paginate(MasterProduct, filter, query, ['categoryId', 'subcategoryId', 'productTypeId']);
    const productIds = result.items.map((p: { _id: unknown }) => p._id);
    const images = await ProductImage.find({ masterProductId: { $in: productIds }, isPrimary: true });
    const imageMap = new Map(images.map((img) => [img.masterProductId.toString(), img]));
    (result as { items: unknown[] }).items = result.items.map((p) => ({
      ...(p as object),
      primaryImage: imageMap.get((p as { _id: { toString: () => string } })._id.toString()) || null,
    }));
    return result;
  }

  static async getById(id: string) {
    const product = await MasterProduct.findById(id)
      .populate(['categoryId', 'subcategoryId', 'productTypeId']);
    if (!product) throw new AppError('Product not found', 404);
    const images = await ProductImage.find({ masterProductId: id }).sort({ displayOrder: 1 });
    return { product, images };
  }

  static async validateAttributes(productTypeId: string, attributes: ProductAttributeValue[]) {
    const mappings = await ProductTypeAttribute.find({ productTypeId }).populate('attributeId');
    const errors: string[] = [];

    for (const mapping of mappings) {
      const attr = mapping.attributeId as unknown as { _id: { toString: () => string }; name: string; type: string; options?: Array<{ value: string; isActive: boolean }> };
      const attrId = attr._id.toString();
      const value = attributes.find((a) => a.attributeId === attrId);

      if (mapping.isRequired && (value === undefined || value.value === '' || value.value === null)) {
        errors.push(`${attr.name} is required`);
        continue;
      }
      if (!value) continue;

      if (attr.type === 'NUMBER' && typeof value.value !== 'number' && isNaN(Number(value.value))) {
        errors.push(`${attr.name} must be a number`);
      }
      if (attr.type === 'BOOLEAN' && typeof value.value !== 'boolean') {
        errors.push(`${attr.name} must be a boolean`);
      }
      if (attr.type === 'DROPDOWN') {
        const allowed = (attr.options || []).filter((o) => o.isActive).map((o) => o.value);
        if (!allowed.includes(String(value.value))) {
          errors.push(`${attr.name} has invalid value`);
        }
      }
      if (attr.type === 'MULTI_SELECT') {
        const allowed = (attr.options || []).filter((o) => o.isActive).map((o) => o.value);
        const vals = Array.isArray(value.value) ? value.value : [value.value];
        if (!vals.every((v) => allowed.includes(String(v)))) {
          errors.push(`${attr.name} has invalid values`);
        }
      }
    }
    return errors;
  }

  static async listBrands(): Promise<string[]> {
    const brands = await MasterProduct.distinct('brand', { brand: { $exists: true, $nin: [null, ''] } });
    return brands.map((b) => String(b)).sort((a, b) => a.localeCompare(b));
  }

  static async create(data: Record<string, unknown>, userId?: string) {
    const { images, ...productData } = data as Record<string, unknown> & {
      images?: Array<{ imageUrl: string; altText?: string; displayOrder?: number; isPrimary?: boolean; fileName?: string; mimeType?: string; fileSize?: number }>;
      attributes?: ProductAttributeValue[];
    };

    if (!isValidGtin(productData.gtin as string)) {
      throw new AppError('Invalid GTIN format', 400);
    }

    const existingSku = await MasterProduct.findOne({ sku: productData.sku });
    if (existingSku) throw new AppError('SKU already exists', 409);

    const attrErrors = await this.validateAttributes(
      productData.productTypeId as string,
      (productData.attributes || []) as ProductAttributeValue[]
    );
    if (attrErrors.length) throw new AppError('Validation failed', 400, attrErrors);

    const slug = productData.slug as string || await uniqueSlug(
      productData.name as string,
      async (s) => !!(await MasterProduct.findOne({ slug: s }))
    );

    const product = await MasterProduct.create({
      ...productData,
      slug,
      createdBy: userId,
      updatedBy: userId,
    });

    if (images?.length) {
      const hasPrimary = images.some((i) => i.isPrimary);
      await ProductImage.insertMany(images.map((img, idx) => ({
        masterProductId: product._id,
        imageUrl: img.imageUrl,
        altText: img.altText,
        displayOrder: img.displayOrder ?? idx,
        isPrimary: img.isPrimary ?? (!hasPrimary && idx === 0),
        fileName: img.fileName,
        mimeType: img.mimeType,
        fileSize: img.fileSize,
      })));
    }

    return this.getById(product._id.toString());
  }

  static async update(id: string, data: Record<string, unknown>, userId?: string) {
    const product = await MasterProduct.findById(id);
    if (!product) throw new AppError('Product not found', 404);

    const { images, ...productData } = data as Record<string, unknown> & {
      images?: Array<{ imageUrl: string; altText?: string; displayOrder?: number; isPrimary?: boolean }>;
      attributes?: ProductAttributeValue[];
    };

    if (productData.sku && productData.sku !== product.sku) {
      const existing = await MasterProduct.findOne({ sku: productData.sku });
      if (existing) throw new AppError('SKU already exists', 409);
    }

    if (productData.attributes) {
      const attrErrors = await this.validateAttributes(
        product.productTypeId.toString(),
        productData.attributes as ProductAttributeValue[]
      );
      if (attrErrors.length) throw new AppError('Validation failed', 400, attrErrors);
    }

    Object.assign(product, productData, { updatedBy: userId });
    await product.save();

    if (images) {
      await ProductImage.deleteMany({ masterProductId: id });
      if (images.length) {
        const hasPrimary = images.some((i) => i.isPrimary);
        await ProductImage.insertMany(images.map((img, idx) => ({
          masterProductId: id,
          imageUrl: img.imageUrl,
          altText: img.altText,
          displayOrder: img.displayOrder ?? idx,
          isPrimary: img.isPrimary ?? (!hasPrimary && idx === 0),
        })));
      }
    }

    return this.getById(id);
  }

  static async delete(id: string) {
    const product = await MasterProduct.findById(id);
    if (!product) throw new AppError('Product not found', 404);
    await ProductImage.deleteMany({ masterProductId: id });
    await MasterProduct.findByIdAndDelete(id);
    return { deleted: true };
  }
}

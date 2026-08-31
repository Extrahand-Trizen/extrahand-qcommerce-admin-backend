"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MasterProductService = void 0;
const MasterProduct_1 = __importDefault(require("../models/MasterProduct"));
const ProductImage_1 = __importDefault(require("../models/ProductImage"));
const ProductTypeAttribute_1 = __importDefault(require("../models/ProductTypeAttribute"));
const slug_1 = require("../utils/slug");
const pagination_1 = require("../utils/pagination");
const response_1 = require("../utils/response");
function isValidGtin(gtin) {
    if (!gtin)
        return true;
    return /^\d{8,14}$/.test(gtin);
}
class MasterProductService {
    static async list(query) {
        const filter = {};
        if (query.status)
            filter.status = query.status;
        if (query.categoryId)
            filter.categoryId = query.categoryId;
        if (query.subcategoryId)
            filter.subcategoryId = query.subcategoryId;
        if (query.productTypeId)
            filter.productTypeId = query.productTypeId;
        if (query.search) {
            filter.$or = [
                { name: { $regex: query.search, $options: 'i' } },
                { brand: { $regex: query.search, $options: 'i' } },
                { sku: { $regex: query.search, $options: 'i' } },
            ];
        }
        const result = await (0, pagination_1.paginate)(MasterProduct_1.default, filter, query, ['categoryId', 'subcategoryId', 'productTypeId']);
        const productIds = result.items.map((p) => p._id);
        const images = await ProductImage_1.default.find({ masterProductId: { $in: productIds }, isPrimary: true });
        const imageMap = new Map(images.map((img) => [img.masterProductId.toString(), img]));
        result.items = result.items.map((p) => ({
            ...p,
            primaryImage: imageMap.get(p._id.toString()) || null,
        }));
        return result;
    }
    static async getById(id) {
        const product = await MasterProduct_1.default.findById(id)
            .populate(['categoryId', 'subcategoryId', 'productTypeId']);
        if (!product)
            throw new response_1.AppError('Product not found', 404);
        const images = await ProductImage_1.default.find({ masterProductId: id }).sort({ displayOrder: 1 });
        return { product, images };
    }
    static async validateAttributes(productTypeId, attributes) {
        const mappings = await ProductTypeAttribute_1.default.find({ productTypeId }).populate('attributeId');
        const errors = [];
        for (const mapping of mappings) {
            const attr = mapping.attributeId;
            const attrId = attr._id.toString();
            const value = attributes.find((a) => a.attributeId === attrId);
            if (mapping.isRequired && (value === undefined || value.value === '' || value.value === null)) {
                errors.push(`${attr.name} is required`);
                continue;
            }
            if (!value)
                continue;
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
    static async listBrands() {
        const brands = await MasterProduct_1.default.distinct('brand', { brand: { $exists: true, $nin: [null, ''] } });
        return brands.map((b) => String(b)).sort((a, b) => a.localeCompare(b));
    }
    static async create(data, userId) {
        const { images, ...productData } = data;
        if (!isValidGtin(productData.gtin)) {
            throw new response_1.AppError('Invalid GTIN format', 400);
        }
        const existingSku = await MasterProduct_1.default.findOne({ sku: productData.sku });
        if (existingSku)
            throw new response_1.AppError('SKU already exists', 409);
        const attrErrors = await this.validateAttributes(productData.productTypeId, (productData.attributes || []));
        if (attrErrors.length)
            throw new response_1.AppError('Validation failed', 400, attrErrors);
        const slug = productData.slug || await (0, slug_1.uniqueSlug)(productData.name, async (s) => !!(await MasterProduct_1.default.findOne({ slug: s })));
        const product = await MasterProduct_1.default.create({
            ...productData,
            slug,
            createdBy: userId,
            updatedBy: userId,
        });
        if (images?.length) {
            const hasPrimary = images.some((i) => i.isPrimary);
            await ProductImage_1.default.insertMany(images.map((img, idx) => ({
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
    static async update(id, data, userId) {
        const product = await MasterProduct_1.default.findById(id);
        if (!product)
            throw new response_1.AppError('Product not found', 404);
        const { images, ...productData } = data;
        if (productData.sku && productData.sku !== product.sku) {
            const existing = await MasterProduct_1.default.findOne({ sku: productData.sku });
            if (existing)
                throw new response_1.AppError('SKU already exists', 409);
        }
        if (productData.attributes) {
            const attrErrors = await this.validateAttributes(product.productTypeId.toString(), productData.attributes);
            if (attrErrors.length)
                throw new response_1.AppError('Validation failed', 400, attrErrors);
        }
        Object.assign(product, productData, { updatedBy: userId });
        await product.save();
        if (images) {
            await ProductImage_1.default.deleteMany({ masterProductId: id });
            if (images.length) {
                const hasPrimary = images.some((i) => i.isPrimary);
                await ProductImage_1.default.insertMany(images.map((img, idx) => ({
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
    static async delete(id) {
        const product = await MasterProduct_1.default.findById(id);
        if (!product)
            throw new response_1.AppError('Product not found', 404);
        await ProductImage_1.default.deleteMany({ masterProductId: id });
        await MasterProduct_1.default.findByIdAndDelete(id);
        return { deleted: true };
    }
}
exports.MasterProductService = MasterProductService;

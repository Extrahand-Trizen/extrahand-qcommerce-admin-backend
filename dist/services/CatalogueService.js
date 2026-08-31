"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogueService = void 0;
const Category_1 = __importDefault(require("../models/Category"));
const Subcategory_1 = __importDefault(require("../models/Subcategory"));
const ProductType_1 = __importDefault(require("../models/ProductType"));
const Attribute_1 = __importDefault(require("../models/Attribute"));
const ProductTypeAttribute_1 = __importDefault(require("../models/ProductTypeAttribute"));
const MasterProduct_1 = __importDefault(require("../models/MasterProduct"));
const slug_1 = require("../utils/slug");
const pagination_1 = require("../utils/pagination");
const response_1 = require("../utils/response");
class CatalogueService {
    // Categories
    static async listCategories(query) {
        const filter = {};
        if (query.status)
            filter.status = query.status;
        if (query.search)
            filter.$or = [
                { name: { $regex: query.search, $options: 'i' } },
                { slug: { $regex: query.search, $options: 'i' } },
            ];
        return (0, pagination_1.paginate)(Category_1.default, filter, query);
    }
    static async getCategory(id) {
        const cat = await Category_1.default.findById(id);
        if (!cat)
            throw new response_1.AppError('Category not found', 404);
        return cat;
    }
    static async createCategory(data, userId) {
        const slug = data.slug || await (0, slug_1.uniqueSlug)(data.name, async (s) => !!(await Category_1.default.findOne({ slug: s })));
        return Category_1.default.create({ ...data, slug, createdBy: userId, updatedBy: userId });
    }
    static async updateCategory(id, data, userId) {
        const cat = await Category_1.default.findById(id);
        if (!cat)
            throw new response_1.AppError('Category not found', 404);
        if (data.name && !data.slug)
            data.slug = (0, slug_1.slugify)(data.name);
        Object.assign(cat, data, { updatedBy: userId });
        await cat.save();
        return cat;
    }
    static async deleteCategory(id) {
        const cat = await Category_1.default.findById(id);
        if (!cat)
            throw new response_1.AppError('Category not found', 404);
        const subCount = await Subcategory_1.default.countDocuments({ categoryId: id });
        if (subCount > 0) {
            throw new response_1.AppError(`Cannot delete: ${subCount} subcategory(ies) exist under this category`, 409);
        }
        const productCount = await MasterProduct_1.default.countDocuments({ categoryId: id });
        if (productCount > 0) {
            throw new response_1.AppError(`Cannot delete: ${productCount} product(s) exist under this category`, 409);
        }
        await Category_1.default.findByIdAndDelete(id);
        return { deleted: true };
    }
    // Subcategories
    static async listSubcategories(query) {
        const filter = {};
        if (query.status)
            filter.status = query.status;
        if (query.categoryId)
            filter.categoryId = query.categoryId;
        if (query.search)
            filter.$or = [
                { name: { $regex: query.search, $options: 'i' } },
                { slug: { $regex: query.search, $options: 'i' } },
            ];
        return (0, pagination_1.paginate)(Subcategory_1.default, filter, query, 'categoryId');
    }
    static async getSubcategory(id) {
        const sub = await Subcategory_1.default.findById(id).populate('categoryId');
        if (!sub)
            throw new response_1.AppError('Subcategory not found', 404);
        return sub;
    }
    static async createSubcategory(data, userId) {
        const category = await Category_1.default.findById(data.categoryId);
        if (!category)
            throw new response_1.AppError('Category not found', 404);
        if (category.status === 'INACTIVE' && data.status !== 'INACTIVE') {
            throw new response_1.AppError('Cannot create active subcategory under inactive category', 400);
        }
        const slug = data.slug || await (0, slug_1.uniqueSlug)(data.name, async (s) => !!(await Subcategory_1.default.findOne({ slug: s })));
        return Subcategory_1.default.create({ ...data, slug, createdBy: userId, updatedBy: userId });
    }
    static async updateSubcategory(id, data, userId) {
        const sub = await Subcategory_1.default.findById(id);
        if (!sub)
            throw new response_1.AppError('Subcategory not found', 404);
        if (data.status === 'ACTIVE') {
            const category = await Category_1.default.findById(sub.categoryId);
            if (category?.status === 'INACTIVE')
                throw new response_1.AppError('Cannot activate subcategory under inactive category', 400);
        }
        Object.assign(sub, data, { updatedBy: userId });
        await sub.save();
        return sub;
    }
    static async deleteSubcategory(id) {
        const sub = await Subcategory_1.default.findById(id);
        if (!sub)
            throw new response_1.AppError('Subcategory not found', 404);
        const typeCount = await ProductType_1.default.countDocuments({ subcategoryId: id });
        if (typeCount > 0) {
            throw new response_1.AppError(`Cannot delete: ${typeCount} product type(s) exist under this subcategory`, 409);
        }
        const productCount = await MasterProduct_1.default.countDocuments({ subcategoryId: id });
        if (productCount > 0) {
            throw new response_1.AppError(`Cannot delete: ${productCount} product(s) exist under this subcategory`, 409);
        }
        await Subcategory_1.default.findByIdAndDelete(id);
        return { deleted: true };
    }
    // Product Types
    static async listProductTypes(query) {
        const filter = {};
        if (query.status)
            filter.status = query.status;
        if (query.categoryId)
            filter.categoryId = query.categoryId;
        if (query.subcategoryId)
            filter.subcategoryId = query.subcategoryId;
        if (query.search)
            filter.$or = [
                { name: { $regex: query.search, $options: 'i' } },
                { slug: { $regex: query.search, $options: 'i' } },
            ];
        return (0, pagination_1.paginate)(ProductType_1.default, filter, query, ['categoryId', 'subcategoryId']);
    }
    static async getProductType(id) {
        const pt = await ProductType_1.default.findById(id).populate(['categoryId', 'subcategoryId']);
        if (!pt)
            throw new response_1.AppError('Product type not found', 404);
        return pt;
    }
    static async createProductType(data, userId) {
        const sub = await Subcategory_1.default.findById(data.subcategoryId);
        if (!sub)
            throw new response_1.AppError('Subcategory not found', 404);
        if (sub.categoryId.toString() !== data.categoryId) {
            throw new response_1.AppError('Subcategory does not belong to the selected category', 400);
        }
        const slug = data.slug || await (0, slug_1.uniqueSlug)(data.name, async (s) => !!(await ProductType_1.default.findOne({ slug: s })));
        return ProductType_1.default.create({ ...data, slug, createdBy: userId, updatedBy: userId });
    }
    static async updateProductType(id, data, userId) {
        const pt = await ProductType_1.default.findById(id);
        if (!pt)
            throw new response_1.AppError('Product type not found', 404);
        Object.assign(pt, data, { updatedBy: userId });
        await pt.save();
        return pt;
    }
    static async deleteProductType(id) {
        const pt = await ProductType_1.default.findById(id);
        if (!pt)
            throw new response_1.AppError('Product type not found', 404);
        const productCount = await MasterProduct_1.default.countDocuments({ productTypeId: id });
        if (productCount > 0) {
            throw new response_1.AppError(`Cannot delete: ${productCount} product(s) use this product type`, 409);
        }
        await ProductTypeAttribute_1.default.deleteMany({ productTypeId: id });
        await ProductType_1.default.findByIdAndDelete(id);
        return { deleted: true };
    }
    // Attributes
    static async listAttributes(query) {
        const filter = {};
        if (query.isActive !== undefined)
            filter.isActive = query.isActive === 'true';
        if (query.search)
            filter.$or = [
                { name: { $regex: query.search, $options: 'i' } },
                { key: { $regex: query.search, $options: 'i' } },
            ];
        return (0, pagination_1.paginate)(Attribute_1.default, filter, query);
    }
    static async getAttribute(id) {
        const attr = await Attribute_1.default.findById(id);
        if (!attr)
            throw new response_1.AppError('Attribute not found', 404);
        return attr;
    }
    static async createAttribute(data, userId) {
        if (!data.key)
            data.key = (0, slug_1.slugify)(data.name).replace(/-/g, '_');
        return Attribute_1.default.create({ ...data, createdBy: userId, updatedBy: userId });
    }
    static async updateAttribute(id, data, userId) {
        const attr = await Attribute_1.default.findById(id);
        if (!attr)
            throw new response_1.AppError('Attribute not found', 404);
        Object.assign(attr, data, { updatedBy: userId });
        await attr.save();
        return attr;
    }
    static async deleteAttribute(id) {
        const attr = await Attribute_1.default.findById(id);
        if (!attr)
            throw new response_1.AppError('Attribute not found', 404);
        const mappingCount = await ProductTypeAttribute_1.default.countDocuments({ attributeId: id });
        if (mappingCount > 0) {
            throw new response_1.AppError(`Cannot delete: attribute is linked to ${mappingCount} product type(s)`, 409);
        }
        await Attribute_1.default.findByIdAndDelete(id);
        return { deleted: true };
    }
    // Product Type Attributes
    static async listProductTypeAttributes(productTypeId) {
        return ProductTypeAttribute_1.default.find({ productTypeId })
            .populate('attributeId')
            .sort({ displayOrder: 1 });
    }
    static async setProductTypeAttributes(productTypeId, mappings) {
        await ProductTypeAttribute_1.default.deleteMany({ productTypeId });
        if (mappings.length === 0)
            return [];
        const docs = mappings.map((m, i) => ({
            productTypeId,
            attributeId: m.attributeId,
            isRequired: m.isRequired ?? false,
            displayOrder: m.displayOrder ?? i,
            defaultValue: m.defaultValue,
        }));
        return ProductTypeAttribute_1.default.insertMany(docs);
    }
}
exports.CatalogueService = CatalogueService;

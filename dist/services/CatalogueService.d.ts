import { PaginationQuery } from '../types';
export declare class CatalogueService {
    static listCategories(query: PaginationQuery & {
        status?: string;
    }): Promise<import("../types").PaginatedResult<import("../models/Category").ICategory>>;
    static getCategory(id: string): Promise<import("mongoose").Document<unknown, {}, import("../models/Category").ICategory, {}, {}> & import("../models/Category").ICategory & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static createCategory(data: Record<string, unknown>, userId?: string): Promise<import("mongoose").Document<unknown, {}, import("../models/Category").ICategory, {}, {}> & import("../models/Category").ICategory & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static updateCategory(id: string, data: Record<string, unknown>, userId?: string): Promise<import("mongoose").Document<unknown, {}, import("../models/Category").ICategory, {}, {}> & import("../models/Category").ICategory & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static deleteCategory(id: string): Promise<{
        deleted: boolean;
    }>;
    static listSubcategories(query: PaginationQuery & {
        status?: string;
        categoryId?: string;
    }): Promise<import("../types").PaginatedResult<import("../models/Subcategory").ISubcategory>>;
    static getSubcategory(id: string): Promise<import("mongoose").Document<unknown, {}, import("../models/Subcategory").ISubcategory, {}, {}> & import("../models/Subcategory").ISubcategory & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static createSubcategory(data: Record<string, unknown>, userId?: string): Promise<import("mongoose").Document<unknown, {}, import("../models/Subcategory").ISubcategory, {}, {}> & import("../models/Subcategory").ISubcategory & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static updateSubcategory(id: string, data: Record<string, unknown>, userId?: string): Promise<import("mongoose").Document<unknown, {}, import("../models/Subcategory").ISubcategory, {}, {}> & import("../models/Subcategory").ISubcategory & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static deleteSubcategory(id: string): Promise<{
        deleted: boolean;
    }>;
    static listProductTypes(query: PaginationQuery & {
        status?: string;
        categoryId?: string;
        subcategoryId?: string;
    }): Promise<import("../types").PaginatedResult<import("../models/ProductType").IProductType>>;
    static getProductType(id: string): Promise<import("mongoose").Document<unknown, {}, import("../models/ProductType").IProductType, {}, {}> & import("../models/ProductType").IProductType & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static createProductType(data: Record<string, unknown>, userId?: string): Promise<import("mongoose").Document<unknown, {}, import("../models/ProductType").IProductType, {}, {}> & import("../models/ProductType").IProductType & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static updateProductType(id: string, data: Record<string, unknown>, userId?: string): Promise<import("mongoose").Document<unknown, {}, import("../models/ProductType").IProductType, {}, {}> & import("../models/ProductType").IProductType & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static deleteProductType(id: string): Promise<{
        deleted: boolean;
    }>;
    static listAttributes(query: PaginationQuery & {
        isActive?: string;
    }): Promise<import("../types").PaginatedResult<import("../models/Attribute").IAttribute>>;
    static getAttribute(id: string): Promise<import("mongoose").Document<unknown, {}, import("../models/Attribute").IAttribute, {}, {}> & import("../models/Attribute").IAttribute & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static createAttribute(data: Record<string, unknown>, userId?: string): Promise<import("mongoose").Document<unknown, {}, import("../models/Attribute").IAttribute, {}, {}> & import("../models/Attribute").IAttribute & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static updateAttribute(id: string, data: Record<string, unknown>, userId?: string): Promise<import("mongoose").Document<unknown, {}, import("../models/Attribute").IAttribute, {}, {}> & import("../models/Attribute").IAttribute & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static deleteAttribute(id: string): Promise<{
        deleted: boolean;
    }>;
    static listProductTypeAttributes(productTypeId: string): Promise<(import("mongoose").Document<unknown, {}, import("../models/ProductTypeAttribute").IProductTypeAttribute, {}, {}> & import("../models/ProductTypeAttribute").IProductTypeAttribute & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    })[]>;
    static setProductTypeAttributes(productTypeId: string, mappings: Array<{
        attributeId: string;
        isRequired?: boolean;
        displayOrder?: number;
        defaultValue?: string;
    }>): Promise<import("mongoose").MergeType<import("mongoose").Document<unknown, {}, import("../models/ProductTypeAttribute").IProductTypeAttribute, {}, {}> & import("../models/ProductTypeAttribute").IProductTypeAttribute & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }, Omit<{
        productTypeId: string;
        attributeId: string;
        isRequired: boolean;
        displayOrder: number;
        defaultValue: string | undefined;
    }, "_id">>[]>;
}

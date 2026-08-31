import { PaginationQuery, ProductAttributeValue } from '../types';
export declare class MasterProductService {
    static list(query: PaginationQuery & {
        status?: string;
        categoryId?: string;
        subcategoryId?: string;
        productTypeId?: string;
    }): Promise<import("../types").PaginatedResult<import("../models/MasterProduct").IMasterProduct>>;
    static getById(id: string): Promise<{
        product: import("mongoose").Document<unknown, {}, import("../models/MasterProduct").IMasterProduct, {}, {}> & import("../models/MasterProduct").IMasterProduct & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
        images: (import("mongoose").Document<unknown, {}, import("../models/ProductImage").IProductImage, {}, {}> & import("../models/ProductImage").IProductImage & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        })[];
    }>;
    static validateAttributes(productTypeId: string, attributes: ProductAttributeValue[]): Promise<string[]>;
    static listBrands(): Promise<string[]>;
    static create(data: Record<string, unknown>, userId?: string): Promise<{
        product: import("mongoose").Document<unknown, {}, import("../models/MasterProduct").IMasterProduct, {}, {}> & import("../models/MasterProduct").IMasterProduct & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
        images: (import("mongoose").Document<unknown, {}, import("../models/ProductImage").IProductImage, {}, {}> & import("../models/ProductImage").IProductImage & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        })[];
    }>;
    static update(id: string, data: Record<string, unknown>, userId?: string): Promise<{
        product: import("mongoose").Document<unknown, {}, import("../models/MasterProduct").IMasterProduct, {}, {}> & import("../models/MasterProduct").IMasterProduct & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
        images: (import("mongoose").Document<unknown, {}, import("../models/ProductImage").IProductImage, {}, {}> & import("../models/ProductImage").IProductImage & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        })[];
    }>;
    static delete(id: string): Promise<{
        deleted: boolean;
    }>;
}

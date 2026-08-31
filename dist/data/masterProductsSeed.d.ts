/**
 * Sample master products for Fresh & Daily Essentials → Fruits & Vegetables.
 */
export type MasterProductSeed = {
    name: string;
    sku: string;
    productTypeSlug: string;
    brand?: string;
    description?: string;
    imageUrl?: string;
    attributes: {
        variety?: string;
        weight: string;
        sold_as: string;
        organic: boolean;
    };
};
export declare const FRESH_FRUITS_VEG_MASTER_PRODUCTS: MasterProductSeed[];
export declare const MASTER_PRODUCT_SEED_META: {
    categorySlug: string;
    subcategorySlug: string;
};

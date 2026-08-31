import { AttributeType } from '../types';
export type AttributeDef = {
    key: string;
    name: string;
    type: AttributeType;
    options?: string[];
};
/** Global reusable attributes */
export declare const ATTRIBUTE_DEFS: AttributeDef[];
export type ProductTypeSeed = {
    name: string;
    slug: string;
    attributes: string[];
    required?: string[];
};
export type SubcategoryCatalogueSeed = {
    subcategorySlug: string;
    categorySlug: string;
    productTypes: ProductTypeSeed[];
};
export declare const SUBCATEGORY_CATALOGUE: SubcategoryCatalogueSeed[];

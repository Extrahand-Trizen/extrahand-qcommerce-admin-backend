"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("../config/database");
const Category_1 = __importDefault(require("../models/Category"));
const Subcategory_1 = __importDefault(require("../models/Subcategory"));
const ProductType_1 = __importDefault(require("../models/ProductType"));
const Attribute_1 = __importDefault(require("../models/Attribute"));
const ProductTypeAttribute_1 = __importDefault(require("../models/ProductTypeAttribute"));
const masterCatalogueSeed_1 = require("../data/masterCatalogueSeed");
async function seedMasterCatalogue() {
    await (0, database_1.connectDatabase)();
    // 1. Upsert all reusable attributes
    const attributeIdByKey = new Map();
    for (const def of masterCatalogueSeed_1.ATTRIBUTE_DEFS) {
        const attr = await Attribute_1.default.findOneAndUpdate({ key: def.key }, {
            name: def.name,
            key: def.key,
            type: def.type,
            isActive: true,
            options: def.options?.map((value, i) => ({
                label: value,
                value,
                displayOrder: i,
                isActive: true,
            })) || [],
        }, { upsert: true, new: true });
        attributeIdByKey.set(def.key, attr._id.toString());
    }
    console.log(`Attributes: ${attributeIdByKey.size}`);
    let productTypeCount = 0;
    let mappingCount = 0;
    // 2. Product types + attribute mappings per subcategory
    for (const entry of masterCatalogueSeed_1.SUBCATEGORY_CATALOGUE) {
        const category = await Category_1.default.findOne({ slug: entry.categorySlug });
        const subcategory = await Subcategory_1.default.findOne({ slug: entry.subcategorySlug });
        if (!category || !subcategory) {
            console.warn(`Skipping ${entry.subcategorySlug} — category/subcategory not found. Run npm run seed:catalogue first.`);
            continue;
        }
        for (let i = 0; i < entry.productTypes.length; i++) {
            const ptSeed = entry.productTypes[i];
            const globalSlug = `${entry.subcategorySlug}-${ptSeed.slug}`;
            const productType = await ProductType_1.default.findOneAndUpdate({ slug: globalSlug }, {
                categoryId: category._id,
                subcategoryId: subcategory._id,
                name: ptSeed.name,
                slug: globalSlug,
                displayOrder: i + 1,
                status: 'ACTIVE',
                description: `${ptSeed.name} — ${subcategory.name}`,
            }, { upsert: true, new: true });
            productTypeCount += 1;
            // Replace attribute mappings for this product type
            await ProductTypeAttribute_1.default.deleteMany({ productTypeId: productType._id });
            const requiredSet = new Set(ptSeed.required || []);
            const mappings = ptSeed.attributes
                .filter((key) => attributeIdByKey.has(key))
                .map((key, idx) => ({
                productTypeId: productType._id,
                attributeId: attributeIdByKey.get(key),
                isRequired: requiredSet.has(key),
                displayOrder: idx + 1,
            }));
            if (mappings.length) {
                await ProductTypeAttribute_1.default.insertMany(mappings);
                mappingCount += mappings.length;
            }
        }
    }
    console.log(`Product types: ${productTypeCount}`);
    console.log(`Product type attribute mappings: ${mappingCount}`);
    console.log('Master catalogue seed complete.');
    process.exit(0);
}
seedMasterCatalogue().catch((err) => {
    console.error(err);
    process.exit(1);
});

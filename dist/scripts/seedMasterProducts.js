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
const MasterProduct_1 = __importDefault(require("../models/MasterProduct"));
const ProductImage_1 = __importDefault(require("../models/ProductImage"));
const slug_1 = require("../utils/slug");
const masterProductsSeed_1 = require("../data/masterProductsSeed");
async function seedMasterProducts() {
    await (0, database_1.connectDatabase)();
    const category = await Category_1.default.findOne({ slug: masterProductsSeed_1.MASTER_PRODUCT_SEED_META.categorySlug });
    const subcategory = await Subcategory_1.default.findOne({ slug: masterProductsSeed_1.MASTER_PRODUCT_SEED_META.subcategorySlug });
    if (!category || !subcategory) {
        console.error('Category or subcategory not found. Run: npm run seed:catalogue');
        process.exit(1);
    }
    const attributes = await Attribute_1.default.find({ key: { $in: ['weight', 'sold_as', 'variety', 'organic'] } });
    const attributeIdByKey = new Map(attributes.map((a) => [a.key, a._id.toString()]));
    const missingAttrs = ['weight', 'sold_as', 'variety', 'organic'].filter((k) => !attributeIdByKey.has(k));
    if (missingAttrs.length) {
        console.error(`Missing attributes: ${missingAttrs.join(', ')}. Run: npm run seed:master`);
        process.exit(1);
    }
    let created = 0;
    let updated = 0;
    for (const seed of masterProductsSeed_1.FRESH_FRUITS_VEG_MASTER_PRODUCTS) {
        const productType = await ProductType_1.default.findOne({ slug: seed.productTypeSlug });
        if (!productType) {
            console.warn(`Skipping ${seed.name} — product type "${seed.productTypeSlug}" not found. Run: npm run seed:master`);
            continue;
        }
        const attributeValues = [
            { attributeId: attributeIdByKey.get('weight'), value: seed.attributes.weight },
            { attributeId: attributeIdByKey.get('sold_as'), value: seed.attributes.sold_as },
            { attributeId: attributeIdByKey.get('organic'), value: seed.attributes.organic },
        ];
        if (seed.attributes.variety) {
            attributeValues.push({ attributeId: attributeIdByKey.get('variety'), value: seed.attributes.variety });
        }
        const slug = (0, slug_1.slugify)(seed.name);
        const existing = await MasterProduct_1.default.findOne({ sku: seed.sku });
        const product = await MasterProduct_1.default.findOneAndUpdate({ sku: seed.sku }, {
            categoryId: category._id,
            subcategoryId: subcategory._id,
            productTypeId: productType._id,
            name: seed.name,
            slug,
            brand: seed.brand,
            description: seed.description,
            sku: seed.sku,
            attributes: attributeValues,
            status: 'ACTIVE',
            createdBy: 'seed',
            updatedBy: 'seed',
        }, { upsert: true, new: true, setDefaultsOnInsert: true });
        if (existing)
            updated += 1;
        else
            created += 1;
        if (seed.imageUrl) {
            await ProductImage_1.default.deleteMany({ masterProductId: product._id });
            await ProductImage_1.default.create({
                masterProductId: product._id,
                imageUrl: seed.imageUrl,
                altText: seed.name,
                displayOrder: 0,
                isPrimary: true,
            });
        }
        console.log(`  ✓ ${seed.name} → ${seed.productTypeSlug.replace('fruits-veg-', '')}`);
    }
    console.log(`\nMaster products seeded: ${created} created, ${updated} updated (${masterProductsSeed_1.FRESH_FRUITS_VEG_MASTER_PRODUCTS.length} total).`);
    process.exit(0);
}
seedMasterProducts().catch((err) => {
    console.error(err);
    process.exit(1);
});

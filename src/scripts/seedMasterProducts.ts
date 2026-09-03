import { connectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import Attribute from '../models/Attribute';
import MasterProduct from '../models/MasterProduct';
import ProductImage from '../models/ProductImage';
import Seller from '../models/Seller';
import SellerListing from '../models/SellerListing';
import { slugify } from '../utils/slug';
import { FRESH_FRUITS_VEG_MASTER_PRODUCTS, MASTER_PRODUCT_SEED_META } from '../data/masterProductsSeed';

const DEFAULT_SELLER_USER_ID = 'seed-default-seller';

async function ensureDefaultSeller() {
  return Seller.findOneAndUpdate(
    { userId: DEFAULT_SELLER_USER_ID },
    {
      userId: DEFAULT_SELLER_USER_ID,
      fullName: 'ExtraHand Dark Store',
      mobileNumber: '9999999999',
      email: 'darkstore@extrahand.in',
      status: 'ACTIVE',
      onboardingStatus: 'APPROVED',
    },
    { upsert: true, new: true }
  );
}

async function seedMasterProducts() {
  await connectDatabase();

  const category = await Category.findOne({ slug: MASTER_PRODUCT_SEED_META.categorySlug });
  const subcategory = await Subcategory.findOne({ slug: MASTER_PRODUCT_SEED_META.subcategorySlug });

  if (!category || !subcategory) {
    console.error('Category or subcategory not found. Run: npm run seed:catalogue');
    process.exit(1);
  }

  const attributes = await Attribute.find({
    key: { $in: ['net_quantity', 'unit', 'sold_as', 'variety', 'organic'] },
  });
  const attributeIdByKey = new Map(attributes.map((a) => [a.key, a._id.toString()]));

  const missingAttrs = ['net_quantity', 'unit', 'sold_as', 'organic'].filter((k) => !attributeIdByKey.has(k));
  if (missingAttrs.length) {
    console.error(`Missing attributes: ${missingAttrs.join(', ')}. Run: npm run seed:master`);
    process.exit(1);
  }

  let created = 0;
  let updated = 0;
  const seller = await ensureDefaultSeller();

  for (const seed of FRESH_FRUITS_VEG_MASTER_PRODUCTS) {
    const productType = await ProductType.findOne({ slug: seed.productTypeSlug });
    if (!productType) {
      console.warn(`Skipping ${seed.name} — product type "${seed.productTypeSlug}" not found. Run: npm run seed:master`);
      continue;
    }

    const attributeValues = [
      { attributeId: attributeIdByKey.get('net_quantity')!, value: seed.attributes.net_quantity },
      { attributeId: attributeIdByKey.get('unit')!, value: seed.attributes.unit },
      { attributeId: attributeIdByKey.get('sold_as')!, value: seed.attributes.sold_as },
      { attributeId: attributeIdByKey.get('organic')!, value: seed.attributes.organic },
    ];

    if (seed.attributes.variety) {
      attributeValues.push({ attributeId: attributeIdByKey.get('variety')!, value: seed.attributes.variety });
    }

    const slug = slugify(seed.name);
    const existing = await MasterProduct.findOne({ sku: seed.sku });
    const sellingPricePaise = Math.round(seed.sellingPrice * 100);
    const compareAtPricePaise =
      seed.compareAtPrice != null ? Math.round(seed.compareAtPrice * 100) : undefined;

    const product = await MasterProduct.findOneAndUpdate(
      { sku: seed.sku },
      {
        categoryId: category._id,
        subcategoryId: subcategory._id,
        productTypeId: productType._id,
        name: seed.name,
        slug,
        brand: seed.brand,
        description: seed.description,
        sku: seed.sku,
        sellingPricePaise,
        attributes: attributeValues,
        status: 'ACTIVE',
        createdBy: 'seed',
        updatedBy: 'seed',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (existing) updated += 1;
    else created += 1;

    if (seed.imageUrl) {
      await ProductImage.deleteMany({ masterProductId: product._id });
      await ProductImage.create({
        masterProductId: product._id,
        imageUrl: seed.imageUrl,
        altText: seed.name,
        displayOrder: 0,
        isPrimary: true,
      });
    }

    await SellerListing.findOneAndUpdate(
      { sellerId: seller._id, masterProductId: product._id },
      {
        sellerId: seller._id,
        masterProductId: product._id,
        sellingPricePaise,
        compareAtPricePaise,
        status: 'ACTIVE',
        availability: 'AVAILABLE',
        reviewStatus: 'APPROVED',
      },
      { upsert: true, new: true }
    );

    console.log(`  ✓ ${seed.name} → ${seed.productTypeSlug.replace('fruits-veg-', '')}`);
  }

  console.log(`\nMaster products seeded: ${created} created, ${updated} updated (${FRESH_FRUITS_VEG_MASTER_PRODUCTS.length} total).`);
  process.exit(0);
}

seedMasterProducts().catch((err) => {
  console.error(err);
  process.exit(1);
});

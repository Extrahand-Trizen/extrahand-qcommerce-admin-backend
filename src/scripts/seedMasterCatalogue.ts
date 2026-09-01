import { connectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import Attribute from '../models/Attribute';
import ProductTypeAttribute from '../models/ProductTypeAttribute';
import {
  ATTRIBUTE_DEFS,
  DEPRECATED_ATTRIBUTE_KEYS,
  RETIRED_PRODUCT_TYPE_SLUGS,
  SUBCATEGORY_CATALOGUE,
  collectActiveProductTypeSlugs,
} from '../data/masterCatalogueSeed';

async function seedMasterCatalogue() {
  await connectDatabase();

  for (const slug of RETIRED_PRODUCT_TYPE_SLUGS) {
    await ProductType.findOneAndUpdate({ slug }, { status: 'INACTIVE' });
  }

  // 1. Upsert all reusable attributes
  const attributeIdByKey = new Map<string, string>();
  for (const def of ATTRIBUTE_DEFS) {
    const attr = await Attribute.findOneAndUpdate(
      { key: def.key },
      {
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
      },
      { upsert: true, new: true }
    );
    attributeIdByKey.set(def.key, attr._id.toString());
  }

  for (const key of DEPRECATED_ATTRIBUTE_KEYS) {
    await Attribute.findOneAndUpdate({ key }, { isActive: false });
  }

  const deprecatedAttrs = await Attribute.find({ key: { $in: [...DEPRECATED_ATTRIBUTE_KEYS] } }).select('_id');
  if (deprecatedAttrs.length) {
    const removed = await ProductTypeAttribute.deleteMany({
      attributeId: { $in: deprecatedAttrs.map((a) => a._id) },
    });
    if (removed.deletedCount) {
      console.log(`Removed ${removed.deletedCount} mappings referencing deprecated attributes`);
    }
  }

  console.log(`Attributes: ${attributeIdByKey.size} active, ${DEPRECATED_ATTRIBUTE_KEYS.length} deprecated`);

  let productTypeCount = 0;
  let mappingCount = 0;
  const activeProductTypeSlugs = collectActiveProductTypeSlugs();

  // 2. Product types + attribute mappings per subcategory
  for (const entry of SUBCATEGORY_CATALOGUE) {
    const category = await Category.findOne({ slug: entry.categorySlug });
    const subcategory = await Subcategory.findOne({ slug: entry.subcategorySlug });

    if (!category || !subcategory) {
      console.warn(`Skipping ${entry.subcategorySlug} — category/subcategory not found. Run npm run seed:catalogue first.`);
      continue;
    }

    for (let i = 0; i < entry.productTypes.length; i++) {
      const ptSeed = entry.productTypes[i];
      const globalSlug = `${entry.subcategorySlug}-${ptSeed.slug}`;

      const productType = await ProductType.findOneAndUpdate(
        { slug: globalSlug },
        {
          categoryId: category._id,
          subcategoryId: subcategory._id,
          name: ptSeed.name,
          slug: globalSlug,
          displayOrder: i + 1,
          status: 'ACTIVE',
          description: `${ptSeed.name} — ${subcategory.name}`,
        },
        { upsert: true, new: true }
      );
      productTypeCount += 1;

      // Replace attribute mappings for this product type
      await ProductTypeAttribute.deleteMany({ productTypeId: productType._id });

      const requiredSet = new Set(ptSeed.required || []);
      const mappings = ptSeed.attributes
        .filter((key) => attributeIdByKey.has(key))
        .map((key, idx) => ({
          productTypeId: productType._id,
          attributeId: attributeIdByKey.get(key)!,
          isRequired: requiredSet.has(key),
          displayOrder: idx + 1,
        }));

      const unknownKeys = ptSeed.attributes.filter((key) => !attributeIdByKey.has(key));
      if (unknownKeys.length) {
        console.warn(`  ! ${globalSlug} — unknown attribute keys: ${unknownKeys.join(', ')}`);
      }

      if (mappings.length) {
        await ProductTypeAttribute.insertMany(mappings);
        mappingCount += mappings.length;
      }
    }
  }

  for (const slug of RETIRED_PRODUCT_TYPE_SLUGS) {
    await ProductType.findOneAndUpdate({ slug }, { status: 'INACTIVE' });
  }

  await ProductType.updateMany(
    {
      slug: { $nin: [...activeProductTypeSlugs, ...RETIRED_PRODUCT_TYPE_SLUGS] },
      status: 'ACTIVE',
    },
    { status: 'INACTIVE' }
  );

  console.log(`Product types: ${productTypeCount} active definitions seeded`);
  console.log(`Retired product types: ${RETIRED_PRODUCT_TYPE_SLUGS.length}`);
  console.log(`Product type attribute mappings: ${mappingCount}`);
  console.log('Master catalogue seed complete.');
  process.exit(0);
}

seedMasterCatalogue().catch((err) => {
  console.error(err);
  process.exit(1);
});

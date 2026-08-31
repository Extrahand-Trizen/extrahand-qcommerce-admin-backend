import { connectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import Attribute from '../models/Attribute';
import ProductTypeAttribute from '../models/ProductTypeAttribute';
import { ATTRIBUTE_DEFS, SUBCATEGORY_CATALOGUE } from '../data/masterCatalogueSeed';

async function seedMasterCatalogue() {
  await connectDatabase();

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
  console.log(`Attributes: ${attributeIdByKey.size}`);

  let productTypeCount = 0;
  let mappingCount = 0;

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

      if (mappings.length) {
        await ProductTypeAttribute.insertMany(mappings);
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

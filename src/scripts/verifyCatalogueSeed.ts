import 'dotenv/config';
import mongoose from 'mongoose';
import {
  ATTRIBUTE_DEFS,
  DEPRECATED_ATTRIBUTE_KEYS,
  RETIRED_PRODUCT_TYPE_SLUGS,
  SUBCATEGORY_CATALOGUE,
  collectActiveProductTypeSlugs,
} from '../data/masterCatalogueSeed';
import Attribute from '../models/Attribute';
import ProductType from '../models/ProductType';
import ProductTypeAttribute from '../models/ProductTypeAttribute';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!, { dbName: process.env.MONGODB_DB });

  const seedCount = SUBCATEGORY_CATALOGUE.reduce((n, e) => n + e.productTypes.length, 0);
  const activePts = await ProductType.countDocuments({ status: 'ACTIVE' });
  const retiredInactive = await ProductType.countDocuments({
    slug: { $in: [...RETIRED_PRODUCT_TYPE_SLUGS] },
    status: 'INACTIVE',
  });
  const activeAttrs = await Attribute.countDocuments({ isActive: true });
  const inactiveAttrs = await Attribute.countDocuments({ isActive: false });

  const brandAttr = await Attribute.findOne({ key: 'brand' });
  const brandMappings = brandAttr
    ? await ProductTypeAttribute.countDocuments({ attributeId: brandAttr._id })
    : 0;

  const deprecatedAttrs = await Attribute.find({ key: { $in: [...DEPRECATED_ATTRIBUTE_KEYS] } });
  const deprecatedMappings = deprecatedAttrs.length
    ? await ProductTypeAttribute.countDocuments({
        attributeId: { $in: deprecatedAttrs.map((a) => a._id) },
      })
    : 0;

  const greenTea = await ProductType.findOne({ slug: 'tea-coffee-green-tea' }).select('status');
  const smallElec = await ProductType.findOne({ slug: 'electronics-small-electronic-accessories' }).select('status');

  const milk = await ProductType.findOne({ slug: 'dairy-milk' }).select('_id');
  let milkRequired: string[] = [];
  if (milk) {
    const maps = await ProductTypeAttribute.find({ productTypeId: milk._id, isRequired: true }).populate(
      'attributeId',
    );
    milkRequired = maps.map((m) => String((m.attributeId as { key?: string }).key || ''));
  }

  const mappingCount = await ProductTypeAttribute.countDocuments();

  console.log('=== Verification ===');
  console.log('Seed product types:', seedCount);
  console.log('Seed slug count:', collectActiveProductTypeSlugs().length);
  console.log('DB active product types:', activePts);
  console.log('Retired INACTIVE:', retiredInactive, '/', RETIRED_PRODUCT_TYPE_SLUGS.length);
  console.log('Seed active attributes:', ATTRIBUTE_DEFS.length);
  console.log('DB active attributes:', activeAttrs);
  console.log('DB inactive attributes:', inactiveAttrs);
  console.log('Total PT-attribute mappings:', mappingCount);
  console.log('Brand mappings:', brandMappings);
  console.log('Deprecated attribute mappings:', deprecatedMappings);
  console.log('Green Tea status:', greenTea?.status);
  console.log('Small Electronic Accessories status:', smallElec?.status);
  console.log('Milk required attrs:', milkRequired.join(', '));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

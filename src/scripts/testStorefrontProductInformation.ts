import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import ProductTypeAttribute from '../models/ProductTypeAttribute';
import ProductImage from '../models/ProductImage';
import MasterProduct from '../models/MasterProduct';
import { MasterProductService } from '../services/MasterProductService';
import { StorefrontService } from '../services/StorefrontService';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${message}`);
  }
}

async function loadMilkFixtures() {
  const category = await Category.findOne({ slug: 'fresh', status: 'ACTIVE' });
  const subcategory = await Subcategory.findOne({ slug: 'dairy', status: 'ACTIVE' });
  const productType = await ProductType.findOne({ slug: 'dairy-milk', status: 'ACTIVE' });

  if (!category || !subcategory || !productType) {
    throw new Error('Catalogue fixtures missing — run npm run seed:catalogue && npm run seed:master');
  }

  const mappings = await ProductTypeAttribute.find({ productTypeId: productType._id }).populate(
    'attributeId',
  );
  const attrValues = mappings
    .filter((m) => m.isRequired)
    .map((m) => {
      const attr = m.attributeId as { _id: { toString: () => string }; key?: string };
      const id = attr._id.toString();
      if (attr.key === 'milk_type') return { attributeId: id, value: 'Cow' };
      if (attr.key === 'net_quantity') return { attributeId: id, value: 500 };
      if (attr.key === 'unit') return { attributeId: id, value: 'ml' };
      return { attributeId: id, value: 'test' };
    });

  return {
    categoryId: category._id.toString(),
    subcategoryId: subcategory._id.toString(),
    productTypeId: productType._id.toString(),
    attrValues,
  };
}

async function main() {
  await connectDatabase();

  const fixtures = await loadMilkFixtures();
  const createdIds: string[] = [];
  const ts = Date.now();

  try {
    console.log('=== Storefront Product Information tests ===\n');

    const withPi = await MasterProductService.create(
      {
        name: 'Storefront PI Milk',
        sku: `TEST-SF-PI-${ts}`,
        categoryId: fixtures.categoryId,
        subcategoryId: fixtures.subcategoryId,
        productTypeId: fixtures.productTypeId,
        brand: 'Test Dairy',
        attributes: fixtures.attrValues,
        productInformation: {
          ingredients: 'Pasteurized cow milk',
          manufacturer: 'Test Dairy Ltd.',
          storageInformation: 'Keep refrigerated',
          usageInstructions: 'Consume within 2 days of opening',
          allergens: 'Contains milk',
          nutritionInformation: {
            servingSize: '100 ml',
            energy: '60 kcal',
            protein: '3 g',
            carbohydrates: '4.8 g',
            totalFat: '3.2 g',
            saturatedFat: '2 g',
            sugar: '4.8 g',
            sodium: '44 mg',
          },
        },
        images: [{ imageUrl: 'https://example.com/milk.jpg', isPrimary: true }],
      },
      'test-script',
    );
    createdIds.push(withPi.product._id.toString());
    const withPiSlug = withPi.product.slug;

    const detailWithPi = await StorefrontService.getProductBySlug(withPiSlug);
    assert(!!detailWithPi.product.id, 'Storefront PDP returns product');
    assert(!!detailWithPi.productInformation, 'Storefront PDP includes productInformation');
    assert(
      detailWithPi.productInformation?.ingredients === 'Pasteurized cow milk',
      'ingredients exposed',
    );
    assert(
      detailWithPi.productInformation?.manufacturer === 'Test Dairy Ltd.',
      'manufacturer exposed',
    );
    assert(
      detailWithPi.productInformation?.storageInformation === 'Keep refrigerated',
      'storageInformation exposed',
    );
    assert(
      detailWithPi.productInformation?.usageInstructions === 'Consume within 2 days of opening',
      'usageInstructions exposed',
    );
    assert(detailWithPi.productInformation?.allergens === 'Contains milk', 'allergens exposed');
    assert(
      detailWithPi.productInformation?.nutritionInformation?.servingSize === '100 ml',
      'nutritionInformation.servingSize exposed',
    );
    assert(
      detailWithPi.productInformation?.nutritionInformation?.protein === '3 g',
      'nutritionInformation.protein exposed',
    );
    assert(Array.isArray(detailWithPi.highlights), 'existing highlights unchanged');
    assert(Array.isArray(detailWithPi.gallery), 'existing gallery unchanged');

    const noPi = await MasterProductService.create(
      {
        name: 'Storefront No PI Milk',
        sku: `TEST-SF-NOPI-${ts}`,
        categoryId: fixtures.categoryId,
        subcategoryId: fixtures.subcategoryId,
        productTypeId: fixtures.productTypeId,
        attributes: fixtures.attrValues,
        images: [{ imageUrl: 'https://example.com/milk2.jpg', isPrimary: true }],
      },
      'test-script',
    );
    createdIds.push(noPi.product._id.toString());

    const detailNoPi = await StorefrontService.getProductBySlug(noPi.product.slug);
    assert(!!detailNoPi.product.id, 'Product without PI loads successfully');
    assert(detailNoPi.productInformation === undefined, 'Product without PI omits productInformation');

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
      process.exitCode = 1;
    } else {
      console.log('Storefront Product Information tests passed.');
    }
  } finally {
    for (const id of createdIds) {
      await ProductImage.deleteMany({ masterProductId: id });
      await MasterProduct.findByIdAndDelete(id).catch(() => undefined);
    }
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

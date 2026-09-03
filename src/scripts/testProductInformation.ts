import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import ProductTypeAttribute from '../models/ProductTypeAttribute';
import Attribute from '../models/Attribute';
import { MasterProductService } from '../services/MasterProductService';
import { AppError } from '../utils/response';
import { ATTRIBUTE_DEFS } from '../data/masterCatalogueSeed';

const PI_KEYS = [
  'ingredients',
  'manufacturer',
  'storageInformation',
  'usageInstructions',
  'allergens',
  'nutritionInformation',
] as const;

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

async function assertThrowsAppError(
  fn: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await fn();
    failed += 1;
    console.error(`  ✗ Expected AppError: ${expectedMessage}`);
  } catch (err) {
    if (err instanceof AppError && err.message === expectedMessage) {
      passed += 1;
      console.log(`  ✓ Throws AppError: ${expectedMessage}`);
    } else {
      failed += 1;
      console.error(`  ✗ Expected AppError "${expectedMessage}", got:`, err);
    }
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

async function verifyNoPiCatalogueMappings(): Promise<void> {
  console.log('\n— Product Information is not in catalogue mappings —');

  const defKeys = new Set(ATTRIBUTE_DEFS.map((d) => d.key));
  for (const key of PI_KEYS) {
    assert(!defKeys.has(key), `ATTRIBUTE_DEFS does not include "${key}"`);
  }

  const piLikeAttrs = await Attribute.find({ key: { $in: [...PI_KEYS] } });
  assert(piLikeAttrs.length === 0, 'No Attribute documents exist for PI field keys');

  const brandAttr = await Attribute.findOne({ key: 'brand' });
  if (brandAttr) {
    const brandMappings = await ProductTypeAttribute.countDocuments({ attributeId: brandAttr._id });
    assert(brandMappings === 0, 'Brand has 0 ProductTypeAttribute mappings');
  }
}

async function main() {
  await connectDatabase();

  const fixtures = await loadMilkFixtures();
  const createdIds: string[] = [];

  try {
    console.log('=== Product Information API tests ===\n');

    console.log('— Create MasterProduct with Product Information —');
    const created = await MasterProductService.create(
      {
        name: 'PI Test Milk',
        sku: `TEST-PI-${Date.now()}`,
        categoryId: fixtures.categoryId,
        subcategoryId: fixtures.subcategoryId,
        productTypeId: fixtures.productTypeId,
        brand: 'Test Brand',
        attributes: fixtures.attrValues,
        productInformation: {
          ingredients: 'Milk',
          manufacturer: 'Test Dairy Ltd.',
          storageInformation: 'Keep refrigerated',
          usageInstructions: 'Consume within 2 days of opening',
          allergens: 'Contains milk',
          nutritionInformation: {
            servingSize: '100 ml',
            energy: '60 kcal',
            protein: '3 g',
          },
        },
      },
      'test-script',
    );
    const productId = created.product._id.toString();
    createdIds.push(productId);

    assert(!!created.product.productInformation, 'Create returns productInformation');
    assert(created.product.productInformation?.ingredients === 'Milk', 'ingredients stored');
    assert(
      created.product.productInformation?.manufacturer === 'Test Dairy Ltd.',
      'manufacturer stored',
    );
    assert(
      created.product.productInformation?.nutritionInformation?.servingSize === '100 ml',
      'nutritionInformation stored',
    );

    console.log('\n— Get MasterProduct returns Product Information —');
    const fetched = await MasterProductService.getById(productId);
    assert(!!fetched.product.productInformation, 'getById returns productInformation');
    assert(
      fetched.product.productInformation?.manufacturer === 'Test Dairy Ltd.',
      'getById manufacturer',
    );

    console.log('\n— Partial update preserves omitted fields —');
    const partialUpdated = await MasterProductService.update(
      productId,
      { productInformation: { ingredients: 'Pasteurized milk' } },
      'test-script',
    );
    assert(
      partialUpdated.product.productInformation?.ingredients === 'Pasteurized milk',
      'ingredients updated',
    );
    assert(
      partialUpdated.product.productInformation?.manufacturer === 'Test Dairy Ltd.',
      'manufacturer preserved on partial patch',
    );
    assert(
      partialUpdated.product.productInformation?.allergens === 'Contains milk',
      'allergens preserved on partial patch',
    );

    console.log('\n— Clear Product Information fields —');
    const cleared = await MasterProductService.update(
      productId,
      { productInformation: { manufacturer: '', allergens: '' } },
      'test-script',
    );
    assert(cleared.product.productInformation?.manufacturer === undefined, 'manufacturer cleared');
    assert(cleared.product.productInformation?.allergens === undefined, 'allergens cleared');
    assert(
      cleared.product.productInformation?.ingredients === 'Pasteurized milk',
      'ingredients still present after clearing other fields',
    );

    console.log('\n— Create/update without Product Information —');
    const noPi = await MasterProductService.create(
      {
        name: 'No PI Test Milk',
        sku: `TEST-NOPI-${Date.now()}`,
        categoryId: fixtures.categoryId,
        subcategoryId: fixtures.subcategoryId,
        productTypeId: fixtures.productTypeId,
        attributes: fixtures.attrValues,
      },
      'test-script',
    );
    createdIds.push(noPi.product._id.toString());
    assert(!noPi.product.productInformation, 'Product without PI has no productInformation');

    const renamed = await MasterProductService.update(
      noPi.product._id.toString(),
      { name: 'No PI Test Milk Renamed' },
      'test-script',
    );
    assert(renamed.product.name === 'No PI Test Milk Renamed', 'Update without PI succeeds');
    assert(!renamed.product.productInformation, 'PI remains absent after unrelated update');

    console.log('\n— ProductTypeAttribute validation —');
    await assertThrowsAppError(
      () =>
        MasterProductService.create(
          {
            name: 'Invalid Milk',
            sku: `TEST-INVALID-${Date.now()}`,
            categoryId: fixtures.categoryId,
            subcategoryId: fixtures.subcategoryId,
            productTypeId: fixtures.productTypeId,
            attributes: [],
          },
          'test-script',
        ),
      'Validation failed',
    );

    await verifyNoPiCatalogueMappings();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
      process.exitCode = 1;
    } else {
      console.log('Product Information API tests passed.');
    }
  } finally {
    for (const id of createdIds) {
      await MasterProductService.delete(id).catch(() => undefined);
    }
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

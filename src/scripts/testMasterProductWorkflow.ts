import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import ProductTypeAttribute from '../models/ProductTypeAttribute';
import Attribute from '../models/Attribute';
import ProductImage from '../models/ProductImage';
import MasterProduct from '../models/MasterProduct';
import Seller from '../models/Seller';
import SellerListing from '../models/SellerListing';
import ProductSubmission from '../models/ProductSubmission';
import { MasterProductService } from '../services/MasterProductService';
import { ProductSubmissionService } from '../services/ProductSubmissionService';
import { AppError } from '../utils/response';
import { ProductAttributeValue } from '../types';

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

async function buildRequiredAttributes(productTypeId: string): Promise<ProductAttributeValue[]> {
  const mappings = await ProductTypeAttribute.find({ productTypeId, isRequired: true });
  const attributeIds = mappings.map((mapping) => mapping.attributeId);
  const attributes = await Attribute.find({ _id: { $in: attributeIds } });
  const attributeById = new Map(attributes.map((attr) => [attr._id.toString(), attr]));

  return mappings.map((mapping) => {
    const attr = attributeById.get(mapping.attributeId.toString());
    const id = mapping.attributeId.toString();
    const key = attr?.key || '';
    if (key === 'milk_type') return { attributeId: id, value: 'Cow' };
    if (key === 'net_quantity') return { attributeId: id, value: 500 };
    if (key === 'unit') return { attributeId: id, value: 'ml' };
    if (key === 'sold_as') return { attributeId: id, value: 'Pack' };
    if (key === 'organic') return { attributeId: id, value: 'false' };
    if (key === 'variety') return { attributeId: id, value: 'Test Variety' };
    if (key === 'country_origin') return { attributeId: id, value: 'India' };
    return { attributeId: id, value: 'test' };
  });
}

async function loadDairyFixtures() {
  const category = await Category.findOne({ slug: 'fresh', status: 'ACTIVE' });
  const subcategory = await Subcategory.findOne({ slug: 'dairy', status: 'ACTIVE' });
  const productType = await ProductType.findOne({ slug: 'dairy-milk', status: 'ACTIVE' });
  if (!category || !subcategory || !productType) {
    throw new Error('Catalogue fixtures missing — run npm run seed:catalogue && npm run seed:master');
  }
  const attributes = await buildRequiredAttributes(productType._id.toString());
  return {
    categoryId: category._id.toString(),
    subcategoryId: subcategory._id.toString(),
    productTypeId: productType._id.toString(),
    attributes,
  };
}

async function loadFruitsFixtures() {
  const category = await Category.findOne({ slug: 'fresh', status: 'ACTIVE' });
  const subcategory = await Subcategory.findOne({ slug: 'fruits-veg', status: 'ACTIVE' });
  const productType = await ProductType.findOne({ slug: 'fruits-veg-fresh-fruits', status: 'ACTIVE' });
  if (!category || !subcategory || !productType) {
    throw new Error('Fruits catalogue fixtures missing — run npm run seed:catalogue && npm run seed:master');
  }
  const attributes = await buildRequiredAttributes(productType._id.toString());
  let soldAsAttributeId: string | undefined;
  const mappings = await ProductTypeAttribute.find({ productTypeId: productType._id });
  const attributeIds = mappings.map((mapping) => mapping.attributeId);
  const attributeDocs = await Attribute.find({ _id: { $in: attributeIds } });
  const attributeById = new Map(attributeDocs.map((attr) => [attr._id.toString(), attr]));
  for (const mapping of mappings) {
    const attr = attributeById.get(mapping.attributeId.toString());
    if (attr?.key === 'sold_as') {
      soldAsAttributeId = attr._id.toString();
      break;
    }
  }
  return {
    categoryId: category._id.toString(),
    subcategoryId: subcategory._id.toString(),
    productTypeId: productType._id.toString(),
    attributes,
    soldAsAttributeId,
  };
}

async function ensureTestSeller(ts: string) {
  return Seller.findOneAndUpdate(
    { userId: `test-mp-workflow-${ts}` },
    {
      userId: `test-mp-workflow-${ts}`,
      fullName: 'Workflow Test Seller',
      mobileNumber: `9999${ts.slice(-6)}`,
      status: 'ACTIVE',
      onboardingStatus: 'APPROVED',
    },
    { upsert: true, new: true },
  );
}

async function cleanupProduct(id: string) {
  await SellerListing.deleteMany({ masterProductId: id });
  await ProductImage.deleteMany({ masterProductId: id });
  await MasterProduct.findByIdAndDelete(id).catch(() => undefined);
}

async function main() {
  await connectDatabase();

  const ts = String(Date.now());
  const createdProductIds: string[] = [];
  const createdSubmissionIds: string[] = [];
  let testSellerId: string | undefined;

  try {
    const dairy = await loadDairyFixtures();
    const fruits = await loadFruitsFixtures();

    console.log('=== Master Product workflow tests ===\n');

    console.log('— Status validation —');
    await assertThrowsAppError(
      () =>
        MasterProductService.create({
          name: 'Invalid Status Product',
          sku: `TEST-STATUS-${ts}`,
          categoryId: dairy.categoryId,
          subcategoryId: dairy.subcategoryId,
          productTypeId: dairy.productTypeId,
          attributes: dairy.attributes,
          status: 'DRAFT',
        }),
      'Invalid status. Allowed values: ACTIVE, INACTIVE',
    );

    console.log('\n— Required attribute validation —');
    await assertThrowsAppError(
      () =>
        MasterProductService.create({
          name: 'Missing Attr Product',
          sku: `TEST-MISSING-${ts}`,
          categoryId: dairy.categoryId,
          subcategoryId: dairy.subcategoryId,
          productTypeId: dairy.productTypeId,
          attributes: [],
        }),
      'Validation failed',
    );

    const valid = await MasterProductService.create({
      name: 'Valid Required Attr Product',
      sku: `TEST-VALID-${ts}`,
      categoryId: dairy.categoryId,
      subcategoryId: dairy.subcategoryId,
      productTypeId: dairy.productTypeId,
      attributes: dairy.attributes,
    });
    createdProductIds.push(valid.product._id.toString());
    assert(!!valid.product._id, 'Valid required attributes are accepted');

    console.log('\n— SKU behaviour —');
    const autoSku = await MasterProductService.create({
      name: 'Auto SKU Product',
      categoryId: dairy.categoryId,
      subcategoryId: dairy.subcategoryId,
      productTypeId: dairy.productTypeId,
      attributes: dairy.attributes,
    });
    createdProductIds.push(autoSku.product._id.toString());
    assert(Boolean(autoSku.product.sku), 'SKU can be omitted and auto-generated');
    assert(
      autoSku.product.sku.startsWith('MP-'),
      'Auto-generated SKU uses MP- prefix',
    );

    await assertThrowsAppError(
      () =>
        MasterProductService.create({
          name: 'Duplicate SKU Product',
          sku: valid.product.sku,
          categoryId: dairy.categoryId,
          subcategoryId: dairy.subcategoryId,
          productTypeId: dairy.productTypeId,
          attributes: dairy.attributes,
        }),
      'SKU already exists',
    );

    console.log('\n— Delete safety —');
    const seller = await ensureTestSeller(ts);
    testSellerId = seller._id.toString();

    const deletable = await MasterProductService.create({
      name: 'Deletable Product',
      sku: `TEST-DEL-${ts}`,
      categoryId: dairy.categoryId,
      subcategoryId: dairy.subcategoryId,
      productTypeId: dairy.productTypeId,
      attributes: dairy.attributes,
      images: [{ imageUrl: 'https://example.com/delete-me.jpg', isPrimary: true }],
    });
    const deletableId = deletable.product._id.toString();
    createdProductIds.push(deletableId);

    const blocked = await MasterProductService.create({
      name: 'Blocked Delete Product',
      sku: `TEST-BLOCK-${ts}`,
      categoryId: dairy.categoryId,
      subcategoryId: dairy.subcategoryId,
      productTypeId: dairy.productTypeId,
      attributes: dairy.attributes,
    });
    const blockedId = blocked.product._id.toString();
    createdProductIds.push(blockedId);

    await SellerListing.create({
      sellerId: seller._id,
      masterProductId: blockedId,
      sellingPricePaise: 4500,
      status: 'ACTIVE',
      availability: 'AVAILABLE',
      reviewStatus: 'APPROVED',
    });

    await assertThrowsAppError(
      () => MasterProductService.delete(blockedId),
      'Cannot delete this product while active seller listings exist. Set the product or seller listings to inactive first.',
    );

    await MasterProductService.delete(deletableId);
    createdProductIds.splice(createdProductIds.indexOf(deletableId), 1);
    const deleted = await MasterProduct.findById(deletableId);
    const orphanImages = await ProductImage.countDocuments({ masterProductId: deletableId });
    assert(!deleted, 'Master product without active listings can be deleted');
    assert(orphanImages === 0, 'ProductImage cleanup verified after delete');

    console.log('\n— Submission packOrSoldAs mapping —');
    const attrsWithoutSoldAs = fruits.attributes.filter(
      (attr) => attr.attributeId !== fruits.soldAsAttributeId,
    );

    const submissionPack = await ProductSubmission.create({
      sellerId: seller._id,
      submittedProductName: 'Workflow Test Banana',
      categoryId: fruits.categoryId,
      brand: 'Farm Fresh',
      packOrSoldAs: 'Pack',
      sellingPricePaise: 5500,
      requestedAttributes: [],
      images: [],
      status: 'PENDING',
    });
    createdSubmissionIds.push(submissionPack._id.toString());

    const reviewedPack = await ProductSubmissionService.review(
      submissionPack._id.toString(),
      'APPROVE',
      undefined,
      'test-script',
      {
        subcategoryId: fruits.subcategoryId,
        productTypeId: fruits.productTypeId,
        attributes: attrsWithoutSoldAs,
        sellingPricePaise: 5500,
        createSellerListing: false,
      },
    );

    const mappedPack = await MasterProduct.findById(reviewedPack.mappedMasterProductId);
    if (mappedPack) createdProductIds.push(mappedPack._id.toString());
    const soldAsValue = mappedPack?.attributes.find(
      (attr) => String(attr.attributeId) === fruits.soldAsAttributeId,
    )?.value;
    assert(soldAsValue === 'Pack', 'packOrSoldAs maps to sold_as when product type supports it');

    const submissionOverride = await ProductSubmission.create({
      sellerId: seller._id,
      submittedProductName: 'Workflow Test Mango',
      categoryId: fruits.categoryId,
      packOrSoldAs: 'Pack',
      sellingPricePaise: 9900,
      requestedAttributes: [],
      images: [],
      status: 'PENDING',
    });
    createdSubmissionIds.push(submissionOverride._id.toString());

    const reviewedOverride = await ProductSubmissionService.review(
      submissionOverride._id.toString(),
      'APPROVE',
      undefined,
      'test-script',
      {
        subcategoryId: fruits.subcategoryId,
        productTypeId: fruits.productTypeId,
        attributes: [
          ...attrsWithoutSoldAs,
          { attributeId: fruits.soldAsAttributeId!, value: 'Loose' },
        ],
        sellingPricePaise: 9900,
        createSellerListing: false,
      },
    );

    const mappedOverride = await MasterProduct.findById(reviewedOverride.mappedMasterProductId);
    if (mappedOverride) createdProductIds.push(mappedOverride._id.toString());
    const overrideSoldAs = mappedOverride?.attributes.find(
      (attr) => String(attr.attributeId) === fruits.soldAsAttributeId,
    )?.value;
    assert(overrideSoldAs === 'Loose', 'Admin explicit sold_as overrides packOrSoldAs mapping');

    const submissionNoPack = await ProductSubmission.create({
      sellerId: seller._id,
      submittedProductName: 'Workflow Test Milk',
      categoryId: dairy.categoryId,
      sellingPricePaise: 4500,
      requestedAttributes: [],
      images: [],
      status: 'PENDING',
    });
    createdSubmissionIds.push(submissionNoPack._id.toString());

    const reviewedNoPack = await ProductSubmissionService.review(
      submissionNoPack._id.toString(),
      'APPROVE',
      undefined,
      'test-script',
      {
        subcategoryId: dairy.subcategoryId,
        productTypeId: dairy.productTypeId,
        attributes: dairy.attributes,
        sellingPricePaise: 4500,
        createSellerListing: false,
      },
    );

    const mappedNoPack = await MasterProduct.findById(reviewedNoPack.mappedMasterProductId);
    if (mappedNoPack) createdProductIds.push(mappedNoPack._id.toString());
    assert(!!mappedNoPack?._id, 'Approval without packOrSoldAs succeeds when admin supplies attributes');

    console.log('\n— Map to existing master product —');
    const existing = await MasterProductService.create({
      name: 'Existing Catalogue Product',
      sku: `TEST-MAP-${ts}`,
      categoryId: dairy.categoryId,
      subcategoryId: dairy.subcategoryId,
      productTypeId: dairy.productTypeId,
      brand: 'Stable Brand',
      attributes: dairy.attributes,
    });
    const existingId = existing.product._id.toString();
    createdProductIds.push(existingId);

    const submissionMap = await ProductSubmission.create({
      sellerId: seller._id,
      submittedProductName: 'Different Seller Name',
      categoryId: dairy.categoryId,
      brand: 'Changed Brand',
      packOrSoldAs: 'Pack',
      sellingPricePaise: 3200,
      requestedAttributes: [],
      images: [],
      status: 'PENDING',
    });
    createdSubmissionIds.push(submissionMap._id.toString());

    await ProductSubmissionService.review(
      submissionMap._id.toString(),
      'APPROVE',
      undefined,
      'test-script',
      {
        masterProductId: existingId,
        sellingPricePaise: 3200,
        createSellerListing: true,
      },
    );

    const afterMap = await MasterProduct.findById(existingId);
    const listing = await SellerListing.findOne({ sellerId: seller._id, masterProductId: existingId });
    assert(afterMap?.name === 'Existing Catalogue Product', 'Map mode does not modify master product name');
    assert(afterMap?.brand === 'Stable Brand', 'Map mode does not modify master product brand');
    assert(!!listing, 'Map mode creates seller listing with supplied price');

    const inactive = await MasterProductService.create({
      name: 'Inactive Catalogue Product',
      sku: `TEST-INACTIVE-MAP-${ts}`,
      categoryId: dairy.categoryId,
      subcategoryId: dairy.subcategoryId,
      productTypeId: dairy.productTypeId,
      attributes: dairy.attributes,
      status: 'INACTIVE',
    });
    const inactiveId = inactive.product._id.toString();
    createdProductIds.push(inactiveId);

    const submissionInactiveMap = await ProductSubmission.create({
      sellerId: seller._id,
      submittedProductName: 'Should Not Map',
      categoryId: dairy.categoryId,
      sellingPricePaise: 3200,
      requestedAttributes: [],
      images: [],
      status: 'PENDING',
    });
    createdSubmissionIds.push(submissionInactiveMap._id.toString());

    await assertThrowsAppError(
      () =>
        ProductSubmissionService.review(
          submissionInactiveMap._id.toString(),
          'APPROVE',
          undefined,
          'test-script',
          {
            masterProductId: inactiveId,
            sellingPricePaise: 3200,
            createSellerListing: true,
          },
        ),
      'Cannot map to an inactive master product',
    );

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
      process.exitCode = 1;
    } else {
      console.log('Master Product workflow tests passed.');
    }
  } finally {
    for (const submissionId of createdSubmissionIds) {
      await ProductSubmission.findByIdAndDelete(submissionId).catch(() => undefined);
    }
    for (const productId of createdProductIds) {
      await cleanupProduct(productId);
    }
    if (testSellerId) {
      await Seller.findByIdAndDelete(testSellerId).catch(() => undefined);
    }
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

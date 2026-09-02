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
import { MasterProductService } from '../services/MasterProductService';
import { SellerCatalogueService } from '../services/SellerCatalogueService';
import { StorefrontService } from '../services/StorefrontService';
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

async function cleanupProduct(id: string) {
  await SellerListing.deleteMany({ masterProductId: id });
  await ProductImage.deleteMany({ masterProductId: id });
  await MasterProduct.findByIdAndDelete(id).catch(() => undefined);
}

async function main() {
  await connectDatabase();

  const ts = String(Date.now());
  const createdProductIds: string[] = [];
  let testSellerId: string | undefined;

  try {
    const dairy = await loadDairyFixtures();

    console.log('=== Critical Master Product fix regression tests ===\n');

    console.log('— Legacy seller listing path uses validated catalogue service —');
    const seller = await Seller.findOneAndUpdate(
      { userId: `test-critical-fixes-${ts}` },
      {
        userId: `test-critical-fixes-${ts}`,
        fullName: 'Critical Fix Test Seller',
        mobileNumber: `8888${ts.slice(-6)}`,
        status: 'ACTIVE',
        onboardingStatus: 'APPROVED',
      },
      { upsert: true, new: true },
    );
    testSellerId = seller._id.toString();

    await assertThrowsAppError(
      () =>
        SellerCatalogueService.addListing(testSellerId!, {
          masterProductId: '000000000000000000000000',
          sellingPricePaise: 1000,
        }),
      'Product not found in catalogue',
    );

    const withImage = await MasterProductService.create({
      name: `Critical Fix With Image ${ts}`,
      sku: `TEST-CF-IMG-${ts}`,
      categoryId: dairy.categoryId,
      subcategoryId: dairy.subcategoryId,
      productTypeId: dairy.productTypeId,
      attributes: dairy.attributes,
      images: [{ imageUrl: 'https://example.com/critical-fix.jpg', isPrimary: true }],
    });
    createdProductIds.push(withImage.product._id.toString());

    const listing = await SellerCatalogueService.addListing(testSellerId!, {
      masterProductId: withImage.product._id.toString(),
      sellingPricePaise: 5500,
    });
    assert(!!listing.id, 'Validated addListing creates seller listing');

    await assertThrowsAppError(
      () =>
        SellerCatalogueService.addListing(testSellerId!, {
          masterProductId: withImage.product._id.toString(),
          sellingPricePaise: 5500,
        }),
      'Product already in your store',
    );

    console.log('\n— Master product delete removes inactive seller listings —');
    const deletable = await MasterProductService.create({
      name: `Critical Fix Deletable ${ts}`,
      sku: `TEST-CF-DEL-${ts}`,
      categoryId: dairy.categoryId,
      subcategoryId: dairy.subcategoryId,
      productTypeId: dairy.productTypeId,
      attributes: dairy.attributes,
      images: [{ imageUrl: 'https://example.com/delete-inactive.jpg', isPrimary: true }],
    });
    const deletableId = deletable.product._id.toString();
    createdProductIds.push(deletableId);

    await SellerListing.create({
      sellerId: seller._id,
      masterProductId: deletableId,
      sellingPricePaise: 4500,
      status: 'INACTIVE',
      availability: 'OUT_OF_STOCK',
      reviewStatus: 'APPROVED',
    });

    await MasterProductService.delete(deletableId);
    createdProductIds.splice(createdProductIds.indexOf(deletableId), 1);

    const orphanListings = await SellerListing.countDocuments({ masterProductId: deletableId });
    const orphanImages = await ProductImage.countDocuments({ masterProductId: deletableId });
    assert(orphanListings === 0, 'Inactive seller listings removed when master product is deleted');
    assert(orphanImages === 0, 'Product images still removed when master product is deleted');

    console.log('\n— Storefront lists seller-listed products even without images —');
    const noImage = await MasterProductService.create({
      name: `Critical Fix No Image ${ts}`,
      sku: `TEST-CF-NOIMG-${ts}`,
      categoryId: dairy.categoryId,
      subcategoryId: dairy.subcategoryId,
      productTypeId: dairy.productTypeId,
      attributes: dairy.attributes,
    });
    const noImageId = noImage.product._id.toString();
    createdProductIds.push(noImageId);

    await SellerListing.create({
      sellerId: seller._id,
      masterProductId: noImageId,
      sellingPricePaise: 3200,
      status: 'ACTIVE',
      availability: 'AVAILABLE',
      reviewStatus: 'APPROVED',
    });

    const page = await StorefrontService.listProducts({ limit: 100 });
    const listed = page.items.find((item) => item.id === noImage.product.slug);
    assert(!!listed, 'Seller-listed product without images appears in storefront list');
    assert(listed?.inStock === true, 'In-stock when any seller has an available listing');
    assert(listed?.price === 32, 'Storefront price comes from seller listing');
    assert(listed?.imageUrl === '', 'Missing image returns empty URL for mobile placeholder');

    const listedCount = await MasterProduct.countDocuments({
      status: 'ACTIVE',
      _id: { $in: await SellerListing.distinct('masterProductId', { status: 'ACTIVE', reviewStatus: 'APPROVED' }) },
    });
    assert(page.total === listedCount, 'Storefront total equals active master products with seller listings');

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
      process.exitCode = 1;
    } else {
      console.log('Critical fix regression tests passed.');
    }
  } finally {
    for (const productId of createdProductIds) {
      await cleanupProduct(productId);
    }
    if (testSellerId) {
      await SellerListing.deleteMany({ sellerId: testSellerId });
      await Seller.findByIdAndDelete(testSellerId).catch(() => undefined);
    }
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

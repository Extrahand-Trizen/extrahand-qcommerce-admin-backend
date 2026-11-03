import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import mongoose from 'mongoose';
import {
  DIWALI_SUBCATEGORIES,
  assertNoProhibitedItems,
  validateSeasonalProductInput,
} from '../utils/seasonalTaxonomy';
import { ProductSubmissionService } from '../services/ProductSubmissionService';
import ProductSubmission from '../models/ProductSubmission';
import MasterProduct from '../models/MasterProduct';
import SellerListing from '../models/SellerListing';
import ShopInventory from '../models/ShopInventory';
import { seasonalActiveMatchFilter } from '../services/storefront/storefrontProductQueries';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed += 1;
    console.log('  ✓ ' + message);
  } else {
    failed += 1;
    console.error('  ✗ ' + message);
  }
}

async function runUnitTaxonomyTests() {
  console.log('\n--- 1. Testing Seasonal Taxonomy & Prohibited Keywords ---');

  // Verify all 7 subcategories
  assert(DIWALI_SUBCATEGORIES.length === 7, 'All 7 Diwali subcategories defined');

  // Prohibited keyword checks
  const prohibitedSamples = [
    'Diwali Patakha / Firecrackers 100 Shots',
    'Sutli Bomb Special Diwali Box',
    'Green Crackers Sparklers & Rockets',
    'Phuljhadi & Anar Festive Combo Pack',
    'Whistling Rockets and Chakri',
  ];

  for (const sample of prohibitedSamples) {
    let blocked = false;
    try {
      assertNoProhibitedItems({ name: sample, description: 'Festive item' });
    } catch (err: any) {
      if (err.message && err.message.includes('Prohibited product violation')) {
        blocked = true;
      }
    }
    assert(blocked, 'Prohibited item blocked: "' + sample + '"');
  }

  // Allowed products must pass
  let allowedPassed = true;
  try {
    assertNoProhibitedItems({
      name: 'Handcrafted Terracotta Clay Diya Pack of 12',
      description: 'Traditional handmade earthenware diyas for Diwali pooja',
      specifications: { diyaType: 'Clay Diya', material: 'Terracotta' },
    });
    assertNoProhibitedItems({
      name: '10m Warm White LED String Lights Fairy Rice Lights',
      description: 'Festive copper wire LED decorative fairy lights with 8 modes',
      specifications: { lightType: 'String Lights', lightTechnology: 'LED' },
    });
  } catch {
    allowedPassed = false;
  }
  assert(allowedPassed, 'Legitimate festive items pass prohibited keyword check');

  const baseInput = {
    name: 'Diwali Festive Product',
    festival: 'Diwali',
    description: 'Traditional auspicious Diwali merchandise',
    mrpPaise: 29900,
    sellingPricePaise: 19900,
    quantity: 50,
    unit: 'Piece',
  };

  // Subcategory 1: Diyas & Oil Lamps validation
  let diyaOk = false;
  try {
    validateSeasonalProductInput({
      ...baseInput,
      seasonalSubcategory: 'Diyas and Oil Lamps',
      specifications: {
        diyaType: 'Clay Diya',
        material: 'Terracotta',
        packQuantity: 12,
      },
      availableFrom: '2026-10-01',
      availableUntil: '2026-11-15',
    });
    diyaOk = true;
  } catch (err: any) {
    console.error('Diya error:', err.message);
    diyaOk = false;
  }
  assert(diyaOk, 'Valid Diyas specifications accepted');

  let invalidDiyaBlocked = false;
  try {
    validateSeasonalProductInput({
      ...baseInput,
      seasonalSubcategory: 'Diyas and Oil Lamps',
      specifications: {
        // missing diyaType
        material: 'Terracotta',
      },
    });
  } catch (err: any) {
    if (err.message && err.message.includes('Diya Type is required')) {
      invalidDiyaBlocked = true;
    }
  }
  assert(invalidDiyaBlocked, 'Missing diyaType correctly rejected');

  // Subcategory 2: Decorative Lights
  let lightsOk = false;
  try {
    validateSeasonalProductInput({
      ...baseInput,
      seasonalSubcategory: 'Decorative Lights and LED String Lights',
      specifications: {
        lightType: 'String Lights',
        lightTechnology: 'LED',
        lengthMeters: 10,
        lightColour: 'Warm White',
      },
    });
    lightsOk = true;
  } catch {
    lightsOk = false;
  }
  assert(lightsOk, 'Valid LED String Lights specifications accepted');

  // Subcategory 3: Candles
  let candlesOk = false;
  try {
    validateSeasonalProductInput({
      ...baseInput,
      seasonalSubcategory: 'Candles',
      specifications: {
        candleType: 'Scented Candle',
        waxType: 'Soy Wax',
        packQuantity: 4,
      },
    });
    candlesOk = true;
  } catch {
    candlesOk = false;
  }
  assert(candlesOk, 'Valid Candles specifications accepted');

  // Subcategory 4: Rangoli
  let rangoliOk = false;
  try {
    validateSeasonalProductInput({
      ...baseInput,
      seasonalSubcategory: 'Rangoli Products and Rangoli Kits',
      specifications: {
        rangoliProductType: 'Rangoli Colour Kit',
        packQuantity: 10,
      },
    });
    rangoliOk = true;
  } catch {
    rangoliOk = false;
  }
  assert(rangoliOk, 'Valid Rangoli specifications accepted');

  // Subcategory 5: Torans
  let toransOk = false;
  try {
    validateSeasonalProductInput({
      ...baseInput,
      seasonalSubcategory: 'Torans and Home Decorations',
      specifications: {
        decorationType: 'Door Toran',
        material: 'Marigold Fabric & Beads',
      },
    });
    toransOk = true;
  } catch {
    toransOk = false;
  }
  assert(toransOk, 'Valid Torans specifications accepted');

  // Subcategory 6: Diwali Gift Hampers
  let nonFoodHamperOk = false;
  try {
    validateSeasonalProductInput({
      ...baseInput,
      seasonalSubcategory: 'Diwali Gift Hampers',
      specifications: {
        hamperName: 'Royal Brass Diya & Toran Festive Box',
        hamperType: 'Decorative Hamper',
        itemsCount: 5,
        packagingType: 'Rigid Gift Box',
        includedProducts: [
          { productName: 'Handmade Brass Diya', quantity: 2, itemType: 'DECORATIVE' },
          { productName: 'Embroidered Door Toran', quantity: 1, itemType: 'DECORATIVE' },
        ],
      },
    });
    nonFoodHamperOk = true;
  } catch {
    nonFoodHamperOk = false;
  }
  assert(nonFoodHamperOk, 'Valid non-food Diwali Gift Hamper accepted');

  // Food hamper without FSSAI must fail
  let foodNoFssaiBlocked = false;
  try {
    validateSeasonalProductInput({
      ...baseInput,
      seasonalSubcategory: 'Diwali Gift Hampers',
      specifications: {
        hamperName: 'Diwali Sweets and Dry Fruit Extravaganza',
        hamperType: 'Gourmet Hamper',
        itemsCount: 4,
        containsFood: true,
        packagingType: 'Velvet Gift Box',
        includedProducts: [
          { productName: 'Kaju Katli', quantity: 1, itemType: 'FOOD' },
        ],
      },
      complianceDetails: {},
    });
  } catch (err: any) {
    if (err.message && err.message.includes('FSSAI')) {
      foodNoFssaiBlocked = true;
    }
  }
  assert(foodNoFssaiBlocked, 'Food-containing hamper requires FSSAI compliance details');

  // Food hamper with FSSAI must pass
  let foodWithFssaiOk = false;
  try {
    validateSeasonalProductInput({
      ...baseInput,
      seasonalSubcategory: 'Diwali Gift Hampers',
      specifications: {
        hamperName: 'Diwali Sweets and Dry Fruit Extravaganza',
        hamperType: 'Gourmet Hamper',
        itemsCount: 4,
        containsFood: true,
        packagingType: 'Velvet Gift Box',
        includedProducts: [
          { productName: 'Kaju Katli', quantity: 1, itemType: 'FOOD' },
        ],
      },
      complianceDetails: {
        fssaiNumber: '10019011000123',
      },
    });
    foodWithFssaiOk = true;
  } catch {
    foodWithFssaiOk = false;
  }
  assert(foodWithFssaiOk, 'Food hamper with FSSAI is accepted');

  // Date range validation
  let invertedDateBlocked = false;
  try {
    validateSeasonalProductInput({
      ...baseInput,
      seasonalSubcategory: 'Diyas and Oil Lamps',
      specifications: { diyaType: 'Clay Diya', material: 'Terracotta', packQuantity: 6 },
      availableFrom: '2026-11-20',
      availableUntil: '2026-10-01', // End date before start date
    });
  } catch (err: any) {
    if (err.message && err.message.includes('earlier')) {
      invertedDateBlocked = true;
    }
  }
  assert(invertedDateBlocked, 'Date range validation correctly catches inverted dates');

  let customClassificationAccepted = false;
  try {
    validateSeasonalProductInput({
      ...baseInput,
      customCategoryName: 'Decorative Seasonal Items',
      seasonalSubcategory: 'Custom Paper Lanterns',
      customSubcategoryName: 'Custom Paper Lanterns',
      customProductTypeName: 'Handmade Lantern',
      specifications: { productType: 'Handmade Lantern' },
    });
    customClassificationAccepted = true;
  } catch {
    customClassificationAccepted = false;
  }
  assert(customClassificationAccepted, 'Custom seasonal category, subcategory, and product type are accepted');

  let prohibitedCustomClassificationBlocked = false;
  try {
    validateSeasonalProductInput({
      ...baseInput,
      customCategoryName: 'Firecracker Decorations',
      seasonalSubcategory: 'Custom Paper Lanterns',
      customSubcategoryName: 'Custom Paper Lanterns',
      customProductTypeName: 'Handmade Lantern',
      specifications: { productType: 'Handmade Lantern' },
    });
  } catch (err: any) {
    prohibitedCustomClassificationBlocked = Boolean(
      err.message && err.message.includes('Prohibited product violation'),
    );
  }
  assert(prohibitedCustomClassificationBlocked, 'Prohibited terms in custom classifications are rejected');
}

async function runDatabaseWorkflowTests() {
  console.log('\n--- 2. Testing End-to-End Database Workflows ---');

  const testSellerId = new mongoose.Types.ObjectId().toString();
  const adminId = new mongoose.Types.ObjectId().toString();
  const createdSubmissionIds: mongoose.Types.ObjectId[] = [];
  const createdMasterProductIds: mongoose.Types.ObjectId[] = [];
  const createdListingIds: mongoose.Types.ObjectId[] = [];
  const createdInventoryIds: mongoose.Types.ObjectId[] = [];

  try {
    // 2.1 Test Kirana product submission (Zero Regression)
    console.log('Testing existing Kirana submission (Zero Regression)...');
    const kiranaSub = await ProductSubmissionService.createRequest(testSellerId, {
      name: 'Aashirvaad Superior MP Sharbati Whole Wheat Atta 5kg',
      brand: 'Aashirvaad',
      categoryId: new mongoose.Types.ObjectId().toString(),
      packOrSoldAs: '5 kg',
      mrpPaise: 35000,
      sellingPricePaise: 32000,
      unit: 'pack',
      quantity: 25,
      manufacturerName: 'ITC Limited',
      manufacturerAddress: '37, J.L. Nehru Road, Kolkata - 700071',
    });
    createdSubmissionIds.push(kiranaSub._id);

    assert(kiranaSub.status === 'PENDING', 'Kirana submission is created in PENDING status');
    assert(kiranaSub.isSeasonalProduct === false, 'Kirana submission has isSeasonalProduct=false');
    assert(kiranaSub.sellingPricePaise === 32000, 'Kirana price stored in paise');

    // 2.2 Test Prohibited Product Submission (Must be blocked)
    console.log('Testing prohibited product submission rejection...');
    let prohibitedSubBlocked = false;
    try {
      await ProductSubmissionService.createRequest(testSellerId, {
        name: 'Diwali Special Standard Firecrackers Rockets & Bombs Combo',
        brand: 'Standard Fireworks',
        categoryId: new mongoose.Types.ObjectId().toString(),
        packOrSoldAs: '1 box',
        mrpPaise: 120000,
        sellingPricePaise: 99900,
        unit: 'box',
        isSeasonalProduct: true,
        festival: 'Diwali',
        seasonalSubcategory: 'Diyas and Oil Lamps',
        specifications: { diyaType: 'Clay Diya', material: 'Terracotta' },
      });
    } catch (err: any) {
      if (err.message && err.message.includes('Prohibited product violation')) {
        prohibitedSubBlocked = true;
      }
    }
    assert(prohibitedSubBlocked, 'Firecracker product submission strictly blocked with 400 error');

    // 2.3 Test Seasonal Product Submission
    console.log('Testing valid Diwali Seasonal Product Submission...');
    const seasonalSub = await ProductSubmissionService.createRequest(testSellerId, {
      name: 'Handcrafted Terracotta Clay Diya Set of 12 for Diwali Pooja',
      brand: 'DesiCrafts',
      categoryId: new mongoose.Types.ObjectId().toString(),
      packOrSoldAs: '12 pcs',
      mrpPaise: 29900,
      sellingPricePaise: 19900,
      unit: 'Set',
      quantity: 50,
      minOrderQuantity: 1,
      maxOrderQuantity: 10,
      description: 'Eco-friendly natural clay diyas handmade by local potters.',
      isSeasonalProduct: true,
      festival: 'Diwali',
      seasonalSubcategory: 'Diyas and Oil Lamps',
      specifications: {
        diyaType: 'Clay Diya',
        material: 'Terracotta',
        colour: 'Natural Red / Brown',
        packQuantity: 12,
        handmade: true,
        wickIncluded: true,
      },
      manufacturerDetails: {
        manufacturerName: 'DesiCrafts Pottery Works',
        manufacturerAddress: 'Khurja Pottery Cluster, UP',
        countryOfOrigin: 'India',
      },
      complianceDetails: {
        netQuantity: '12 Pieces',
        mrpDeclaration: 'Rs. 299.00 (Inclusive of all taxes)',
        consumerCareContact: 'help@desicrafts.in',
      },
      availableFrom: '2026-10-01T00:00:00.000Z',
      availableUntil: '2026-11-20T23:59:59.999Z',
    });
    createdSubmissionIds.push(seasonalSub._id);

    assert(seasonalSub.status === 'PENDING', 'Seasonal submission is created in PENDING status');
    assert(seasonalSub.isSeasonalProduct === true, 'isSeasonalProduct is true');
    assert(seasonalSub.festival === 'Diwali', 'Festival is Diwali');
    assert(seasonalSub.seasonalSubcategory === 'Diyas and Oil Lamps', 'Subcategory correctly set');
    assert(seasonalSub.specifications?.diyaType === 'Clay Diya', 'Specifications saved accurately');
    assert(seasonalSub.minOrderQuantity === 1 && seasonalSub.maxOrderQuantity === 10, 'Min/Max order quantities saved');

    // 2.4 Test Admin Review - Rejection without comment (Must fail)
    console.log('Testing Admin rejection validation...');
    let rejectionValidationBlocked = false;
    try {
      await ProductSubmissionService.review(
        seasonalSub._id.toString(),
        'REJECT',
        '   ',
        adminId
      );
    } catch (err: any) {
      if (err.message && err.message.includes('Rejection reason is required')) {
        rejectionValidationBlocked = true;
      }
    }
    assert(rejectionValidationBlocked, 'Admin rejection without reason is rejected with mandatory error');

    // 2.5 Test Admin Review - Approval
    console.log('Testing Admin approval...');
    const approvedSub = await ProductSubmissionService.review(
      seasonalSub._id.toString(),
      'APPROVE',
      'Approved for Diwali 2026 festive catalogue',
      adminId
    );

    assert(approvedSub.status === 'APPROVED', 'Submission status transitioned to APPROVED');
    assert(approvedSub.adminComment === 'Approved for Diwali 2026 festive catalogue', 'Admin comment recorded');

    // Verify MasterProduct was created with vertical SEASONAL
    const masterProduct = await MasterProduct.findOne({ name: seasonalSub.submittedProductName });
    assert(masterProduct !== null, 'MasterProduct created on approval');
    if (masterProduct) {
      createdMasterProductIds.push(masterProduct._id);
      assert(masterProduct.vertical === 'SEASONAL', 'MasterProduct vertical is SEASONAL');
      assert(masterProduct.isSeasonalProduct === true, 'MasterProduct isSeasonalProduct is true');
      assert(masterProduct.festival === 'Diwali', 'MasterProduct festival is Diwali');
      assert(masterProduct.seasonalSubcategory === 'Diyas and Oil Lamps', 'MasterProduct seasonalSubcategory is saved');
      assert(masterProduct.productInformation?.festival === 'Diwali', 'productInformation contains festival');
      assert(masterProduct.productInformation?.specifications?.diyaType === 'Clay Diya', 'productInformation contains specifications');
    }

    // Verify SellerListing was created
    const sellerListing = await SellerListing.findOne({ sellerId: new mongoose.Types.ObjectId(testSellerId) });
    assert(sellerListing !== null, 'SellerListing created for seller');
    if (sellerListing) {
      createdListingIds.push(sellerListing._id);
      assert(sellerListing.sellingPricePaise === 19900, 'SellerListing price matches selling price in paise');
      assert(sellerListing.compareAtPricePaise === 29900, 'SellerListing mrp matches submission in paise');
      assert(sellerListing.customProductInformation?.isSeasonalProduct === true, 'Listing customProductInformation has seasonal flag');
    }

    // Verify ShopInventory was created
    const inventory = await ShopInventory.findOne({ sellerId: new mongoose.Types.ObjectId(testSellerId) });
    assert(inventory !== null, 'ShopInventory record created');
    if (inventory) {
      createdInventoryIds.push(inventory._id);
      assert(inventory.stock === 50, 'Inventory stock initialized to 50');
    }

    // 2.6 Test Date Availability Query Filtering
    console.log('Testing Storefront Seasonal Date Availability Filter...');
    const now = new Date();
    const activeDateFilter = seasonalActiveMatchFilter();
    assert(activeDateFilter !== undefined, 'Seasonal storefront filter is defined');

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const testActiveDoc = new MasterProduct({
      name: 'Active Diya',
      category: 'Seasonal',
      subcategory: 'Diwali',
      productType: 'Decor',
      packSize: '1 set',
      vertical: 'SEASONAL',
      isSeasonalProduct: true,
      festival: 'Diwali',
      seasonalSubcategory: 'Diyas and Oil Lamps',
      availableFrom: yesterday,
      availableUntil: tomorrow,
      status: 'ACTIVE',
    });

    const testExpiredDoc = new MasterProduct({
      name: 'Expired Diya',
      category: 'Seasonal',
      subcategory: 'Diwali',
      productType: 'Decor',
      packSize: '1 set',
      vertical: 'SEASONAL',
      isSeasonalProduct: true,
      festival: 'Diwali',
      seasonalSubcategory: 'Diyas and Oil Lamps',
      availableFrom: new Date(Date.now() - 48 * 60 * 60 * 1000),
      availableUntil: yesterday,
      status: 'ACTIVE',
    });

    await testActiveDoc.save();
    await testExpiredDoc.save();
    createdMasterProductIds.push(testActiveDoc._id, testExpiredDoc._id);

    const visibleProducts = await MasterProduct.find({
      _id: { $in: [testActiveDoc._id, testExpiredDoc._id] },
      ...activeDateFilter,
    });

    assert(visibleProducts.length === 1, 'Storefront query returns only active seasonal product');
    assert(visibleProducts[0]._id.toString() === testActiveDoc._id.toString(), 'Active Diya included, Expired Diya excluded');

  } finally {
    console.log('\nCleaning up test records...');
    if (createdSubmissionIds.length > 0) {
      await ProductSubmission.deleteMany({ _id: { $in: createdSubmissionIds } });
    }
    if (createdMasterProductIds.length > 0) {
      await MasterProduct.deleteMany({ _id: { $in: createdMasterProductIds } });
    }
    if (createdListingIds.length > 0) {
      await SellerListing.deleteMany({ _id: { $in: createdListingIds } });
    }
    if (createdInventoryIds.length > 0) {
      await ShopInventory.deleteMany({ _id: { $in: createdInventoryIds } });
    }
    console.log('Cleanup complete.');
  }
}

async function run() {
  try {
    await runUnitTaxonomyTests();
    // Only attempt database integration if MONGODB_URI is provided and accessible
    if (process.env.TEST_DB === 'true') {
      await connectDatabase();
      await runDatabaseWorkflowTests();
    }
  } catch (err) {
    console.error('Test execution error:', err);
    failed += 1;
  } finally {
    try {
      await disconnectDatabase();
    } catch {
      // ignore
    }
    console.log('\n=======================================');
    console.log('TOTAL PASSED: ' + passed);
    console.log('TOTAL FAILED: ' + failed);
    console.log('=======================================');
    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

run();

require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || 'extrahand' });
  require('./dist/models/register');
  const { Seller, SellerListing } = require('./dist/models');
  const { SellerCatalogueService } = require('./dist/services/SellerCatalogueService');

  const sellerId = '6b06bdb0e3a1c757a49e9a0d'; // Venkatesh Test Store
  const seller = await Seller.findById(sellerId).lean();
  console.log('Seller:', {
    id: seller._id,
    shopName: seller.shopName,
    status: seller.status,
    onboardingStatus: seller.onboardingStatus,
  });

  const listings = await SellerCatalogueService.listMyListings(sellerId, { limit: 200 });
  console.log('listMyListings result:', {
    total: listings.total,
    page: listings.page,
    limit: listings.limit,
    itemsCount: listings.items.length,
  });

  if (listings.items.length > 0) {
    const first = listings.items[0];
    console.log('First listing:', {
      id: first.id,
      masterProductId: first.masterProductId,
      name: first.name,
      sellingPriceRupees: first.sellingPriceRupees,
      sellingPricePaise: first.sellingPricePaise,
      mrpPaise: first.compareAtPricePaise,
      stock: first.stock,
      availability: first.availability,
      reviewStatus: first.reviewStatus,
      imageUrl: first.imageUrl,
      categoryName: first.categoryName,
      categoryId: first.categoryId,
    });

    // Check if any listing has missing id, missing name, or invalid fields
    let missingId = 0;
    let missingName = 0;
    let underReviewCount = 0;
    for (const item of listings.items) {
      if (!item.id) missingId++;
      if (!item.name) missingName++;
      if (item.reviewStatus === 'under_review') underReviewCount++;
    }
    console.log('Integrity check:', {
      totalChecked: listings.items.length,
      missingId,
      missingName,
      underReviewCount,
    });
  }

  await mongoose.disconnect();
}

main().catch(console.error);

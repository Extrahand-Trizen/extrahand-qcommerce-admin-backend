import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import MasterProduct from '../models/MasterProduct';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import ProductImage from '../models/ProductImage';
import Seller from '../models/Seller';
import SellerListing from '../models/SellerListing';
import { StorefrontService } from '../services/StorefrontService';

async function main() {
  await connectDatabase();
  const names = ['Apple', 'Workflow Test Mango', 'Workflow Test Banana', 'Nandhini curd'];
  const products = await MasterProduct.find({ name: { $in: names } }).lean();
  console.log('=== Master products ===');
  for (const p of products) {
    const cat = await Category.findById(p.categoryId).select('name slug').lean();
    const sub = await Subcategory.findById(p.subcategoryId).select('name slug').lean();
    const pt = await ProductType.findById(p.productTypeId).select('name slug').lean();
    const imgs = await ProductImage.countDocuments({ masterProductId: p._id });
    const listings = await SellerListing.find({ masterProductId: p._id })
      .populate('sellerId', 'fullName userId')
      .lean();
    console.log(
      JSON.stringify(
        {
          name: p.name,
          slug: p.slug,
          status: p.status,
          category: cat?.slug,
          subcategory: sub?.slug,
          productType: pt?.slug,
          images: imgs,
          listings: listings.map((l) => ({
            seller: (l.sellerId as { fullName?: string; userId?: string })?.fullName,
            sellerUserId: (l.sellerId as { fullName?: string; userId?: string })?.userId,
            sellerId: l.sellerId,
            status: l.status,
            review: l.reviewStatus,
            price: l.sellingPricePaise / 100,
            avail: l.availability,
          })),
        },
        null,
        2,
      ),
    );
  }

  const sellers = await Seller.find({ status: 'ACTIVE' }).select('fullName userId').lean();
  console.log('\n=== Active sellers ===');
  for (const s of sellers) {
    const count = await SellerListing.countDocuments({
      sellerId: s._id,
      status: 'ACTIVE',
      reviewStatus: 'APPROVED',
    });
    console.log(s.fullName, s.userId, 'listings:', count, 'id:', s._id.toString());
  }

  const page = await StorefrontService.listProducts({ limit: 50 });
  console.log('\n=== Storefront list (auto seller) total:', page.total, 'items:', page.items.length);
  for (const item of page.items) {
    console.log('-', item.name, item.id, 'inStock:', item.inStock, 'price:', item.price);
  }

  for (const s of sellers) {
    const sellerPage = await StorefrontService.listProducts({ limit: 50, sellerId: s._id.toString() });
    console.log(`\n=== Storefront for seller ${s.fullName} (${s._id}) ===`);
    console.log('total:', sellerPage.total, 'items:', sellerPage.items.length);
    for (const item of sellerPage.items) {
      console.log('-', item.name, 'inStock:', item.inStock);
    }
  }

  await disconnectDatabase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

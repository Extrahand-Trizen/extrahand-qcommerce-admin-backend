import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import SellerListing from '../models/SellerListing';
import MasterProduct from '../models/MasterProduct';
import Seller from '../models/Seller';

async function main() {
  await connectDatabase();
  const listingCount = await SellerListing.countDocuments();
  const productCount = await MasterProduct.countDocuments();
  const sellers = await Seller.find().select('_id fullName');
  console.log('Total Listings:', listingCount, 'Total MasterProducts:', productCount);
  for (const s of sellers) {
    const c = await SellerListing.countDocuments({ sellerId: s._id });
    console.log(`Seller: ${s._id.toString()} (${s.fullName}) listings: ${c}`);
  }
  await disconnectDatabase();
}
main().catch(console.error);

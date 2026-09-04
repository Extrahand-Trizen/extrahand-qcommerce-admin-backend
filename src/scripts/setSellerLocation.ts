/**
 * Update a seller's shop location/address in SellerOnboarding.
 *
 *   npx ts-node src/scripts/setSellerLocation.ts <mobileOrSellerId>
 *
 * Edit the NEW_* constants below first. Prints before/after.
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';

// ---- edit these ----
const NEW_LATITUDE = 18.571405;
const NEW_LONGITUDE = 83.364566;
const NEW_ADDRESS = 'Bobbili, Andhra Pradesh';
const NEW_CITY = 'Bobbili';
const NEW_STATE = 'Andhra Pradesh';
const NEW_PINCODE = '535558';
// --------------------

async function main() {
  await connectDatabase();
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: ts-node src/scripts/setSellerLocation.ts <mobileNumber | sellerId>');
    process.exit(1);
  }

  const seller = Types.ObjectId.isValid(arg)
    ? await Seller.findById(arg).lean()
    : await Seller.findOne({ mobileNumber: arg }).lean();
  if (!seller) {
    console.error('No seller matched', arg);
    process.exit(1);
  }
  console.log(`Seller: ${seller.fullName}  ${seller._id}  (${seller.mobileNumber})`);

  const onb = await SellerOnboarding.findOne({ sellerId: seller._id });
  if (!onb) {
    console.error('No SellerOnboarding doc for this seller.');
    process.exit(1);
  }

  console.log('\nBEFORE:');
  console.log(`  ${onb.shopName}`);
  console.log(`  lat/lng : ${onb.latitude} , ${onb.longitude}`);
  console.log(`  address : ${onb.address}`);
  console.log(`  city/state/pin : ${onb.city} / ${onb.state} / ${onb.pincode}`);

  onb.latitude = NEW_LATITUDE;
  onb.longitude = NEW_LONGITUDE;
  onb.address = NEW_ADDRESS;
  onb.city = NEW_CITY;
  onb.state = NEW_STATE;
  onb.pincode = NEW_PINCODE;
  await onb.save();

  const after = await SellerOnboarding.findById(onb._id).lean();
  console.log('\nAFTER:');
  console.log(`  lat/lng : ${after!.latitude} , ${after!.longitude}`);
  console.log(`  address : ${after!.address}`);
  console.log(`  city/state/pin : ${after!.city} / ${after!.state} / ${after!.pincode}`);
  console.log('\nSaved.');

  await disconnectDatabase();
}

main().catch((e) => { console.error(e); process.exit(1); });

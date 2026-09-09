/**
 * Verifies the "stock hit 0" seller signal:
 *  - InventoryService.finalizeOrderDeduction reports which products depleted
 *  - it only reports the transition (in-stock -> OUT_OF_STOCK), not repeats
 * Run: npx ts-node src/scripts/testOutOfStockNotify.ts
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import MasterProduct from '../models/MasterProduct';
import SellerListing from '../models/SellerListing';
import ShopInventory from '../models/ShopInventory';
import { InventoryService } from '../services/InventoryService';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`❌ ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function run() {
  await connectDatabase();
  const ts = Date.now();
  const sellerId = new mongoose.Types.ObjectId();

  const category = await Category.create({ name: `OOS ${ts}`, slug: `oos-${ts}`, code: ('O' + Math.random().toString(36).slice(2, 6)).toUpperCase(), status: 'ACTIVE' });
  const sub = await Subcategory.create({ categoryId: category._id, name: 'S', slug: `oos-s-${ts}`, status: 'ACTIVE' });
  const pt = await ProductType.create({ categoryId: category._id, subcategoryId: sub._id, name: 'T', slug: `oos-t-${ts}`, status: 'ACTIVE' });
  const mp = await MasterProduct.create({ name: `OOS Milk ${ts}`, slug: `oos-milk-${ts}`, sku: `OOS-${ts}`, categoryId: category._id, subcategoryId: sub._id, productTypeId: pt._id, sellingPricePaise: 5000, status: 'ACTIVE' });

  const listing = await SellerListing.create({ sellerId, masterProductId: mp._id, sellingPricePaise: 5000, stock: 2, reserved: 0, status: 'ACTIVE', availability: 'AVAILABLE', reviewStatus: 'APPROVED' });
  await ShopInventory.create({ sellerId, listingId: listing._id, masterProductId: mp._id, stock: 2, reserved: 0 });

  const items = [{ masterProductId: mp._id, quantity: 1 }];

  console.log('\n=== Order 1: buy 1 of 2 — still in stock ===');
  await InventoryService.reserveOrderStock(sellerId, items);
  let r = await InventoryService.finalizeOrderDeduction(sellerId, items);
  assert(r.depleted.length === 0, 'no depletion reported (1 left)');
  let l = await SellerListing.findById(listing._id).lean();
  assert(l!.stock === 1 && l!.availability === 'AVAILABLE', 'stock 1, still AVAILABLE');

  console.log('\n=== Order 2: buy the last one — depletes ===');
  await InventoryService.reserveOrderStock(sellerId, items);
  r = await InventoryService.finalizeOrderDeduction(sellerId, items);
  assert(r.depleted.length === 1, 'exactly 1 product reported as depleted');
  assert(r.depleted[0].masterProductId === String(mp._id), 'the depleted product is ours');
  assert(r.depleted[0].listingId === String(listing._id), 'depleted entry carries the listingId (for the restock deep-link)');
  l = await SellerListing.findById(listing._id).lean();
  assert(l!.stock === 0 && l!.availability === 'OUT_OF_STOCK', 'stock 0, availability OUT_OF_STOCK');

  console.log('\n=== Restock +3, sell 3 — depletes again (fresh transition) ===');
  await InventoryService.setStock(sellerId, String(listing._id), 3);
  await InventoryService.reserveOrderStock(sellerId, [{ masterProductId: mp._id, quantity: 3 }]);
  r = await InventoryService.finalizeOrderDeduction(sellerId, [{ masterProductId: mp._id, quantity: 3 }]);
  assert(r.depleted.length === 1, 'reports depletion again after restock+sellout');

  await Promise.all([
    SellerListing.deleteMany({ sellerId }), ShopInventory.deleteMany({ sellerId }),
    MasterProduct.deleteOne({ _id: mp._id }), ProductType.deleteOne({ _id: pt._id }),
    Subcategory.deleteOne({ _id: sub._id }), Category.deleteOne({ _id: category._id }),
  ]);

  console.log('\n🎉 OUT-OF-STOCK SIGNAL: ALL CHECKS PASSED\n');
  await disconnectDatabase();
  process.exit(0);
}

run().catch(async (e) => { console.error('\n', e); await disconnectDatabase().catch(() => {}); process.exit(1); });

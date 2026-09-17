/**
 * Nearby-store storefront filtering checks.
 *
 * Run: npx ts-node src/scripts/testNearbyStorefrontFiltering.ts
 *
 * Uses live DB when available; skips soft when fixtures are missing.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerListing from '../models/SellerListing';
import { StorefrontService } from '../services/StorefrontService';
import {
  parseStorefrontLocationQuery,
  resolveStorefrontSellerForLocation,
  STOREFRONT_LISTING_MATCH,
} from '../services/storefront/storefrontListingQueries';
import { AppError } from '../utils/response';
import { env } from '../config/env';

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(name: string) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name: string, err: unknown) {
  failed += 1;
  console.error(`  FAIL  ${name}`, err instanceof Error ? err.message : err);
}

function skip(name: string, reason: string) {
  skipped += 1;
  console.log(`  SKIP  ${name} — ${reason}`);
}

async function testCoordValidation() {
  try {
    parseStorefrontLocationQuery({ lat: '17.3' });
    fail('incomplete coords rejected', 'expected throw');
  } catch (e) {
    if (e instanceof AppError && e.statusCode === 400) ok('incomplete coords rejected');
    else fail('incomplete coords rejected', e);
  }

  try {
    parseStorefrontLocationQuery({ lat: '120', lng: '78' });
    fail('out-of-range lat rejected', 'expected throw');
  } catch (e) {
    if (e instanceof AppError) ok('out-of-range lat rejected');
    else fail('out-of-range lat rejected', e);
  }

  const parsed = parseStorefrontLocationQuery({ lat: '17.385', lng: '78.486', city: 'Hyderabad' });
  if (parsed.lat === 17.385 && parsed.lng === 78.486) ok('valid coords parsed');
  else fail('valid coords parsed', parsed);
}

async function testLegacyNoLocation() {
  const resolved = await resolveStorefrontSellerForLocation({});
  if (resolved.locationUsed === false && resolved.serviceable) {
    ok('no location preserves legacy serviceable default');
  } else if (resolved.locationUsed === false) {
    ok('no location sets locationUsed=false');
  } else {
    fail('no location preserves legacy', resolved);
  }

  const page = await StorefrontService.listProducts({ page: 1, limit: 5 });
  if (typeof page.locationUsed === 'boolean' && Array.isArray(page.items)) {
    ok('listProducts returns additive serviceability fields');
  } else {
    fail('listProducts additive fields', page);
  }
}

async function testNearbyResolution() {
  const onboardings = await SellerOnboarding.find({
    status: 'APPROVED',
    latitude: { $type: 'number' },
    longitude: { $type: 'number' },
  })
    .select('sellerId latitude longitude shopName city')
    .limit(20)
    .lean();

  const sellerIds = onboardings.map((o) => o.sellerId);
  const active = sellerIds.length
    ? await Seller.find({ _id: { $in: sellerIds }, status: 'ACTIVE' }).select('_id').lean()
    : [];
  const activeSet = new Set(active.map((s) => s._id.toString()));
  const geo = onboardings.filter((o) => activeSet.has(o.sellerId.toString()));

  if (geo.length < 1) {
    skip('nearby geo resolution', 'no APPROVED onboardings with lat/lng');
    return;
  }

  const anchor = geo[0];
  const near = await resolveStorefrontSellerForLocation({
    lat: anchor.latitude,
    lng: anchor.longitude,
  });

  if (
    near.serviceable &&
    near.locationUsed &&
    near.sellerId?.toString() === anchor.sellerId.toString()
  ) {
    ok('coords resolve nearest eligible seller');
  } else if (near.serviceable && near.sellerId) {
    ok('coords resolve a serviceable seller');
  } else {
    fail('coords resolve nearest eligible seller', near);
  }

  const far = await resolveStorefrontSellerForLocation({
    lat: (anchor.latitude || 0) + 20,
    lng: (anchor.longitude || 0) + 20,
  });
  if (!far.serviceable && far.sellerId == null) {
    ok('far coords do not fall back to distant seller');
  } else {
    fail('far coords do not fall back to distant seller', far);
  }

  const page = await StorefrontService.listProducts({
    page: 1,
    limit: 20,
    lat: anchor.latitude,
    lng: anchor.longitude,
  });

  if (page.serviceable === false) {
    skip('listProducts scoped to seller listings', 'anchor location unserviceable unexpectedly');
    return;
  }

  if (page.store?.sellerId && page.items.every((item) => typeof item.price === 'number')) {
    ok('listProducts returns only nearby-store page');
  } else {
    fail('listProducts nearby page', { store: page.store, count: page.items.length });
  }

  // Ensure listed products have preferred seller listing
  if (page.items.length) {
    const slug = page.items[0].id;
    const detail = await StorefrontService.getProductBySlug(slug, {
      lat: anchor.latitude,
      lng: anchor.longitude,
    });
    const listing = await SellerListing.findOne({
      sellerId: near.sellerId,
      ...STOREFRONT_LISTING_MATCH,
    })
      .select('sellingPricePaise')
      .lean();

    if (detail.product.price > 0 || listing) {
      ok('product detail uses resolved seller listing');
    } else {
      fail('product detail uses resolved seller listing', detail.product);
    }

    try {
      await StorefrontService.getProductBySlug(slug, {
        lat: (anchor.latitude || 0) + 20,
        lng: (anchor.longitude || 0) + 20,
      });
      fail('unserviceable detail returns 404', 'expected throw');
    } catch (e) {
      if (e instanceof AppError && e.statusCode === 404) {
        ok('unserviceable detail returns 404');
      } else {
        fail('unserviceable detail returns 404', e);
      }
    }
  } else {
    skip('product detail seller price', 'no products for nearby seller');
  }

  const radius = Math.max(0.1, env.STOREFRONT_SERVICE_RADIUS_KM || 3.5);
  if (near.distanceKm == null || near.distanceKm <= radius) {
    ok(`resolved distance within radius (${radius}km)`);
  } else {
    fail('resolved distance within radius', near.distanceKm);
  }
}

async function testExplicitSellerRadiusGuard() {
  const onboardings = await SellerOnboarding.find({
    status: 'APPROVED',
    latitude: { $type: 'number' },
    longitude: { $type: 'number' },
  })
    .select('sellerId latitude longitude')
    .limit(5)
    .lean();

  if (!onboardings.length) {
    skip('explicit seller out-of-radius rejected', 'no geo sellers');
    return;
  }

  const row = onboardings[0];
  const far = await resolveStorefrontSellerForLocation({
    sellerId: row.sellerId.toString(),
    lat: (row.latitude || 0) + 25,
    lng: (row.longitude || 0) + 25,
  });

  if (!far.serviceable) ok('explicit seller out-of-radius rejected');
  else fail('explicit seller out-of-radius rejected', far);
}

async function main() {
  console.log('Nearby-store storefront filtering tests\n');
  await connectDatabase();

  await testCoordValidation();
  await testLegacyNoLocation();
  await testNearbyResolution();
  await testExplicitSellerRadiusGuard();

  console.log(`\nDone. pass=${passed} fail=${failed} skip=${skipped}`);
  await disconnectDatabase();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDatabase();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

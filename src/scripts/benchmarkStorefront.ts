/**
 * Storefront performance benchmark — run with:
 *   npx ts-node src/scripts/benchmarkStorefront.ts
 *
 * Requires MONGODB_URI in env (loads .env via config).
 */
import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { StorefrontService } from '../services/StorefrontService';
import { clearStorefrontCaches } from '../services/storefront/storefrontCache';
import MasterProduct from '../models/MasterProduct';
import SellerListing from '../models/SellerListing';
import {
  listedProductLookupStage,
  hasListedProductMatchStage,
  STOREFRONT_LISTING_MATCH,
} from '../services/storefront/storefrontListingQueries';

type ExplainStats = {
  executionTimeMs?: number;
  totalDocsExamined?: number;
  totalKeysExamined?: number;
  nReturned?: number;
  indexName?: string;
};

async function explainListedProductsPage(skip: number, limit: number): Promise<ExplainStats> {
  const pipeline = [
    { $match: { status: 'ACTIVE' } },
    listedProductLookupStage(),
    hasListedProductMatchStage(),
    { $sort: { createdAt: -1 as const } },
    { $skip: skip },
    { $limit: limit },
  ];

  const explained = await MasterProduct.db.db!.command({
    aggregate: MasterProduct.collection.name,
    pipeline,
    cursor: {},
    explain: true,
  });

  const stats =
    (explained as { executionStats?: Record<string, number> }).executionStats ??
    (explained as { stages?: Array<{ executionStats?: Record<string, number> }> }).stages?.at(-1)
      ?.executionStats;

  return {
    executionTimeMs: stats?.executionTimeMillis,
    totalDocsExamined: stats?.totalDocsExamined,
    totalKeysExamined: stats?.totalKeysExamined,
    nReturned: stats?.nReturned,
  };
}

async function explainBestListingAggregation(productIds: unknown[]): Promise<ExplainStats> {
  if (!productIds.length) return {};

  const pipeline = [
    {
      $match: {
        masterProductId: { $in: productIds },
        ...STOREFRONT_LISTING_MATCH,
      },
    },
    {
      $addFields: {
        _inStockRank: {
          $cond: [{ $in: ['$availability', ['AVAILABLE', 'LIMITED']] }, 0, 1],
        },
      },
    },
    { $sort: { _inStockRank: 1, sellingPricePaise: 1 } },
    {
      $group: {
        _id: '$masterProductId',
        sellingPricePaise: { $first: '$sellingPricePaise' },
        compareAtPricePaise: { $first: '$compareAtPricePaise' },
        availability: { $first: '$availability' },
      },
    },
  ];

  const explained = await SellerListing.db.db!.command({
    aggregate: SellerListing.collection.name,
    pipeline,
    cursor: {},
    explain: true,
  });

  const stats =
    (explained as { executionStats?: Record<string, number> }).executionStats ??
    (explained as { stages?: Array<{ executionStats?: Record<string, number> }> }).stages?.at(-1)
      ?.executionStats;

  return {
    executionTimeMs: stats?.executionTimeMillis,
    totalDocsExamined: stats?.totalDocsExamined,
    totalKeysExamined: stats?.totalKeysExamined,
    nReturned: stats?.nReturned,
  };
}

async function timeRequest(label: string, fn: () => Promise<unknown>) {
  clearStorefrontCaches();
  const start = process.hrtime.bigint();
  await fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  console.log(`${label}: ${ms.toFixed(1)}ms`);
  return ms;
}

async function main() {
  await connectDatabase();

  console.log('\n=== Storefront benchmark (optimized) ===\n');

  await timeRequest('GET /store/home (cold caches)', () => StorefrontService.getHome());
  await timeRequest('GET /store/home (warm caches)', () => StorefrontService.getHome());
  await timeRequest('GET /store/products (page 1)', () =>
    StorefrontService.listProducts({ page: 1, limit: 20 }),
  );
  await timeRequest('GET /store/products (search)', () =>
    StorefrontService.listProducts({ page: 1, limit: 30, search: 'milk' }),
  );
  await timeRequest('GET /store/products (category filter)', () =>
    StorefrontService.listProducts({ page: 1, limit: 50, categorySlug: 'grocery' }),
  );

  const sample = await MasterProduct.findOne({ status: 'ACTIVE' }).select('slug').lean();
  if (sample?.slug) {
    await timeRequest(`GET /store/products/:slug (${sample.slug})`, () =>
      StorefrontService.getProductBySlug(sample.slug),
    );
  } else {
    console.log('No active product found for PDP benchmark');
  }

  console.log('\n=== MongoDB explain (executionStats) ===\n');

  const listedPageExplain = await explainListedProductsPage(0, 20);
  console.log('Listed products page aggregation:', listedPageExplain);

  const productIds = await MasterProduct.find({ status: 'ACTIVE' })
    .select('_id')
    .limit(20)
    .lean();
  const bestListingExplain = await explainBestListingAggregation(productIds.map((p) => p._id));
  console.log('Best listing aggregation (20 products):', bestListingExplain);

  console.log('\n=== Order polling load estimate ===');
  console.log('1,000 active orders ÷ 8s ≈ 125 GET /store/orders/:id requests/second');
  console.log('Each request: single CustomerOrder.findOne by _id + userId (indexed) — light per request, scales with concurrent pollers.\n');

  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

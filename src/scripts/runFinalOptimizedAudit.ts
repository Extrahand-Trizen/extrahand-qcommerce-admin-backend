import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import mongoose, { Types } from 'mongoose';
import Seller from '../models/Seller';
import SellerListing from '../models/SellerListing';
import CustomerOrder from '../models/CustomerOrder';
import MasterProduct from '../models/MasterProduct';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import { SellerCatalogueService } from '../services/SellerCatalogueService';
import { QcOrderService } from '../services/QcOrderService';
import { SellerPaymentService } from '../services/SellerPaymentService';
import { SellerService } from '../services/SellerService';
import { SellerStoreSettingsService } from '../services/SellerStoreSettingsService';

interface BenchmarkStat {
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  avg: number;
  throughput: number;
  errorRate: number;
}

function calculateStats(latencies: number[], totalDurationMs: number, errorCount: number): BenchmarkStat {
  if (latencies.length === 0) {
    return { min: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0, throughput: 0, errorRate: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const throughput = Math.round((latencies.length / (totalDurationMs / 1000)) * 10) / 10;
  const errorRate = Math.round((errorCount / (latencies.length + errorCount)) * 1000) / 10;

  return { min, p50, p95, p99, max, avg: Math.round(avg * 10) / 10, throughput, errorRate };
}

async function runBenchmark(
  name: string,
  concurrencyLevels: number[],
  fn: () => Promise<void>,
  runsPerLevel: number = 50,
) {
  console.log(`\n========================================`);
  console.log(`BENCHMARK: ${name}`);
  console.log(`========================================`);

  const results: Record<number, BenchmarkStat> = {};

  for (const c of concurrencyLevels) {
    const latencies: number[] = [];
    let errors = 0;
    const totalRequests = Math.max(c * 2, runsPerLevel);
    const startWall = Date.now();

    // Execute in batches of size c
    let completed = 0;
    while (completed < totalRequests) {
      const batchSize = Math.min(c, totalRequests - completed);
      const promises: Promise<void>[] = [];

      for (let i = 0; i < batchSize; i++) {
        promises.push(
          (async () => {
            const t0 = performance.now();
            try {
              await fn();
              latencies.push(performance.now() - t0);
            } catch (e) {
              errors++;
            }
          })(),
        );
      }

      await Promise.all(promises);
      completed += batchSize;
    }

    const totalDuration = Date.now() - startWall;
    const stat = calculateStats(latencies, totalDuration, errors);
    results[c] = stat;

    console.log(
      `Concurrency ${String(c).padStart(2)}: p50 = ${String(Math.round(stat.p50)).padStart(4)} ms | ` +
      `p95 = ${String(Math.round(stat.p95)).padStart(4)} ms | ` +
      `p99 = ${String(Math.round(stat.p99)).padStart(4)} ms | ` +
      `Throughput = ${String(stat.throughput).padStart(6)} req/s | Errors = ${stat.errorRate}%`,
    );
  }

  return results;
}

async function runScreenSimulations(sellerId: string) {
  console.log(`\n========================================`);
  console.log(`SELLER APP SCREEN LOADING SIMULATIONS`);
  console.log(`========================================`);

  // Screen 1: Dashboard (Cold Start)
  // Store Settings + In-Flight Deduped Orders + Notifications (simulated store load)
  {
    const start = performance.now();
    let apiCount = 0;

    // Simulate in-flight deduped load
    const [settings, orders] = await Promise.all([
      (async () => { apiCount++; return SellerStoreSettingsService.getForSeller(sellerId); })(),
      (async () => { apiCount++; return QcOrderService.listSellerOrders(sellerId, {}); })(),
    ]);

    // Product fetch: conditional check as implemented in DashboardScreen
    if (orders.items.length === 0) {
      apiCount++;
      await SellerCatalogueService.listMyListings(sellerId, { limit: 6 });
    }

    const duration = performance.now() - start;
    console.log(`1. Dashboard (Cold Start):`);
    console.log(`   - APIs dispatched: ${apiCount}`);
    console.log(`   - Screen Usable Latency: ${Math.round(duration)} ms`);
    console.log(`   - Products fetched unconditionally? NO (orders count: ${orders.items.length})`);
  }

  // Screen 2: Dashboard (Warm Start / Screen Focus)
  {
    const start = performance.now();
    let apiCount = 0;

    const [settings, orders] = await Promise.all([
      (async () => { apiCount++; return SellerStoreSettingsService.getForSeller(sellerId); })(),
      (async () => { apiCount++; return QcOrderService.listSellerOrders(sellerId, {}); })(),
    ]);

    const duration = performance.now() - start;
    console.log(`2. Dashboard (Warm Start / Focus):`);
    console.log(`   - APIs dispatched: ${apiCount}`);
    console.log(`   - Screen Usable Latency: ${Math.round(duration)} ms`);
  }

  // Screen 3: Orders Screen
  {
    const start = performance.now();
    const orders = await QcOrderService.listSellerOrders(sellerId, {});
    const duration = performance.now() - start;
    console.log(`3. Orders Screen (Tab Switch):`);
    console.log(`   - APIs dispatched: 1`);
    console.log(`   - Orders returned: ${orders.items.length}`);
    console.log(`   - Screen Usable Latency: ${Math.round(duration)} ms`);
  }

  // Screen 4: Catalogue Screen
  {
    const start = performance.now();
    const catalogue = await SellerCatalogueService.listMyListings(sellerId, { limit: 20 });
    const duration = performance.now() - start;
    console.log(`4. Catalogue Screen (Tab Switch):`);
    console.log(`   - APIs dispatched: 1 (paginated limit=20)`);
    console.log(`   - Listings returned: ${catalogue.items.length} (total: ${catalogue.total})`);
    console.log(`   - Screen Usable Latency: ${Math.round(duration)} ms`);
  }

  // Screen 5: Earnings Screen
  {
    const start = performance.now();
    let apiCount = 0;

    const [revenue, settlements] = await Promise.all([
      (async () => { apiCount++; return SellerPaymentService.getRevenueAnalytics(sellerId); })(),
      (async () => { apiCount++; return SellerPaymentService.getSettlements(sellerId); })(),
    ]);

    const duration = performance.now() - start;
    console.log(`5. Earnings Screen (Tab Switch):`);
    console.log(`   - APIs dispatched: ${apiCount}`);
    console.log(`   - Screen Usable Latency: ${Math.round(duration)} ms`);
  }
}

async function main() {
  await connectDatabase();
  console.log('Starting Final Optimized Performance Benchmark & Concurrency Audit...');

  const seller = await Seller.findOne({});
  if (!seller) throw new Error('No seller found');
  const sellerId = String(seller._id);

  console.log(`Testing with Seller: ${sellerId} (${(seller as any).shopName || 'Store'})`);

  const concurrencyLevels = [1, 5, 10, 25, 50];

  // 1. GET /seller/listings
  const listingsStats = await runBenchmark('GET /seller/listings (P0)', concurrencyLevels, async () => {
    await SellerCatalogueService.listMyListings(sellerId, { limit: 20 });
  });

  // 2. GET /seller/orders
  const ordersStats = await runBenchmark('GET /seller/orders (P0)', concurrencyLevels, async () => {
    await QcOrderService.listSellerOrders(sellerId, {});
  });

  // 3. GET /seller/revenue
  const revenueStats = await runBenchmark('GET /seller/revenue (P1)', concurrencyLevels, async () => {
    await SellerPaymentService.getRevenueAnalytics(sellerId);
  });

  // 4. GET /seller/settlements
  const settlementsStats = await runBenchmark('GET /seller/settlements (P1)', concurrencyLevels, async () => {
    await SellerPaymentService.getSettlements(sellerId);
  });

  // 5. GET /seller/store-settings
  const settingsStats = await runBenchmark('GET /seller/store-settings (P0)', concurrencyLevels, async () => {
    await SellerStoreSettingsService.getForSeller(sellerId);
  });

  // 6. GET /seller/onboarding/me
  const onboardingStats = await runBenchmark('GET /seller/onboarding/me (P1)', concurrencyLevels, async () => {
    await SellerService.getSeller(sellerId);
  });

  // Screen loading simulations
  await runScreenSimulations(sellerId);

  await disconnectDatabase();
  console.log('\nFinal Optimized Audit Complete!');
}

main().catch(console.error);

import assert from 'assert';

interface MockProduct {
  id: string;
  name: string;
  brand: string;
  categoryId: string;
  stock: number;
  reserved: number;
  available?: number;
  shopId: string;
}

type StockStatusFilter = 'all' | 'in_stock' | 'out_of_stock';

function computeAvailable(p: MockProduct): number {
  if (typeof p.available === 'number') return p.available;
  return Math.max(0, (p.stock ?? 0) - (p.reserved ?? 0));
}

function filterProducts(
  products: MockProduct[],
  options: {
    search?: string;
    categoryId?: string;
    stockStatus?: StockStatusFilter;
    shopId?: string;
  },
): MockProduct[] {
  const q = (options.search || '').trim().toLowerCase();
  const categoryId = options.categoryId || 'all';
  const stockStatus = options.stockStatus || 'all';

  return products.filter((p) => {
    if (options.shopId && p.shopId !== options.shopId) return false;

    const matchSearch =
      !q || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q);
    const matchCat = categoryId === 'all' || p.categoryId === categoryId;

    const available = computeAvailable(p);
    let matchStock = true;
    if (stockStatus === 'in_stock') {
      matchStock = available > 0;
    } else if (stockStatus === 'out_of_stock') {
      matchStock = available <= 0;
    }

    return matchSearch && matchCat && matchStock;
  });
}

function runTests() {
  console.log('==================================================');
  console.log('Testing Stock Status Availability Filter Scenarios');
  console.log('==================================================\n');

  const mockShopA = 'shop_A';
  const mockShopB = 'shop_B';

  const dataset: MockProduct[] = [
    { id: '1', name: 'Amul Taaza Fresh Milk 500ml', brand: 'Amul', categoryId: 'dairy', stock: 10, reserved: 0, shopId: mockShopA },
    { id: '2', name: 'Nandini GoodLife Milk 1L', brand: 'Nandini', categoryId: 'dairy', stock: 10, reserved: 8, shopId: mockShopA }, // available: 2 -> IN STOCK
    { id: '3', name: 'Mother Dairy Full Cream Milk 500ml', brand: 'Mother Dairy', categoryId: 'dairy', stock: 5, reserved: 5, shopId: mockShopA }, // available: 0 -> OUT OF STOCK
    { id: '4', name: 'Britannia White Bread 400g', brand: 'Britannia', categoryId: 'bakery', stock: 15, reserved: 2, shopId: mockShopA }, // available: 13 -> IN STOCK
    { id: '5', name: 'Modern Brown Bread 400g', brand: 'Modern', categoryId: 'bakery', stock: 0, reserved: 0, shopId: mockShopA }, // available: 0 -> OUT OF STOCK
    { id: '6', name: 'Lay\'s Classic Salted Chips', brand: 'Lay\'s', categoryId: 'snacks', stock: 20, reserved: 0, shopId: mockShopB }, // Shop B product
  ];

  // Test 1 — All
  console.log('Test 1 — All:');
  const allShopA = filterProducts(dataset, { shopId: mockShopA, stockStatus: 'all' });
  assert.strictEqual(allShopA.length, 5, 'Shop A should have 5 total products under All');
  console.log('✅ PASS: All 5 products in Shop A are returned');

  // Test 2 — In Stock
  console.log('\nTest 2 — In Stock:');
  const inStock = filterProducts(dataset, { shopId: mockShopA, stockStatus: 'in_stock' });
  assert.strictEqual(inStock.length, 3, 'Should return 3 in-stock products');
  inStock.forEach((p) => {
    const avail = computeAvailable(p);
    assert(avail > 0, `Product ${p.name} must have available > 0 (has ${avail})`);
  });
  console.log('✅ PASS: Only products with available quantity > 0 returned');

  // Test 3 — Out of Stock
  console.log('\nTest 3 — Out of Stock:');
  const outOfStock = filterProducts(dataset, { shopId: mockShopA, stockStatus: 'out_of_stock' });
  assert.strictEqual(outOfStock.length, 2, 'Should return 2 out-of-stock products');
  outOfStock.forEach((p) => {
    const avail = computeAvailable(p);
    assert(avail <= 0, `Product ${p.name} must have available <= 0 (has ${avail})`);
  });
  console.log('✅ PASS: Only products with available quantity = 0 returned');

  // Test 4 — Reserved But Available (Total: 10, Reserved: 8, Available: 2)
  console.log('\nTest 4 — Reserved But Available:');
  const nandini = dataset.find((p) => p.id === '2')!;
  assert.strictEqual(computeAvailable(nandini), 2);
  const inStockIds = inStock.map((p) => p.id);
  assert(inStockIds.includes('2'), 'Nandini (stock 10, reserved 8 -> available 2) must appear in In Stock');
  const outOfStockIds = outOfStock.map((p) => p.id);
  assert(!outOfStockIds.includes('2'), 'Nandini must NOT appear in Out of Stock');
  console.log('✅ PASS: Product with active reservations but remaining available units appears under In Stock');

  // Test 5 — Fully Reserved (Total: 5, Reserved: 5, Available: 0)
  console.log('\nTest 5 — Fully Reserved:');
  const motherDairy = dataset.find((p) => p.id === '3')!;
  assert.strictEqual(computeAvailable(motherDairy), 0);
  assert(outOfStockIds.includes('3'), 'Mother Dairy (stock 5, reserved 5 -> available 0) must appear in Out of Stock');
  assert(!inStockIds.includes('3'), 'Mother Dairy must NOT appear in In Stock');
  console.log('✅ PASS: Fully reserved product (available = 0) correctly appears under Out of Stock');

  // Test 6 — Reservation Expires
  console.log('\nTest 6 — Reservation Expires:');
  // Simulate order reservation expired: reserved drops from 5 to 0
  const updatedProduct = { ...motherDairy, reserved: 0 };
  const dynamicList = dataset.map((p) => (p.id === '3' ? updatedProduct : p));
  const newInStock = filterProducts(dynamicList, { shopId: mockShopA, stockStatus: 'in_stock' });
  assert(newInStock.some((p) => p.id === '3'), 'Mother Dairy should now be In Stock after reservation expired');
  console.log('✅ PASS: Expired reservation automatically moves product to In Stock');

  // Test 7 — Search + In Stock
  console.log('\nTest 7 — Search + In Stock:');
  const searchInStock = filterProducts(dataset, { shopId: mockShopA, search: 'Milk', stockStatus: 'in_stock' });
  assert.strictEqual(searchInStock.length, 2, 'Only in-stock Milk products (Amul, Nandini) returned');
  searchInStock.forEach((p) => {
    assert(p.name.includes('Milk') && computeAvailable(p) > 0);
  });
  console.log('✅ PASS: Search combined with In Stock returns matching in-stock products');

  // Test 8 — Search + Out of Stock
  console.log('\nTest 8 — Search + Out of Stock:');
  const searchOutOfStock = filterProducts(dataset, { shopId: mockShopA, search: 'Milk', stockStatus: 'out_of_stock' });
  assert.strictEqual(searchOutOfStock.length, 1, 'Only out-of-stock Milk (Mother Dairy) returned');
  assert.strictEqual(searchOutOfStock[0].id, '3');
  console.log('✅ PASS: Search combined with Out of Stock returns matching out-of-stock product');

  // Test 9 — Category + Stock
  console.log('\nTest 9 — Category + Stock:');
  const catOutOfStock = filterProducts(dataset, { shopId: mockShopA, categoryId: 'bakery', stockStatus: 'out_of_stock' });
  assert.strictEqual(catOutOfStock.length, 1);
  assert.strictEqual(catOutOfStock[0].name, 'Modern Brown Bread 400g');
  console.log('✅ PASS: Category combined with Out of Stock returns matching bakery product');

  // Test 10 — Clear Filters
  console.log('\nTest 10 — Clear Filters:');
  let currentStock: StockStatusFilter = 'out_of_stock';
  let currentCategory = 'bakery';
  // Simulate clear filters
  currentStock = 'all';
  currentCategory = 'all';
  const cleared = filterProducts(dataset, { shopId: mockShopA, categoryId: currentCategory, stockStatus: currentStock });
  assert.strictEqual(cleared.length, 5, 'Clear filters returns all products for Shop A');
  console.log('✅ PASS: Clear filters resets to all products');

  // Test 11 — Multiple Shops
  console.log('\nTest 11 — Multiple Shops:');
  const shopBProducts = filterProducts(dataset, { shopId: mockShopB, stockStatus: 'all' });
  assert.strictEqual(shopBProducts.length, 1);
  assert.strictEqual(shopBProducts[0].name, 'Lay\'s Classic Salted Chips');
  assert(!shopBProducts.some((p) => p.shopId === mockShopA), 'Shop B should not see Shop A products');
  console.log('✅ PASS: Multi-shop inventory isolation verified');

  console.log('\n==================================================');
  console.log('All 11 Stock Filter Scenarios PASSED! 🎉');
  console.log('==================================================');
}

runTests();

import { connectDatabase } from '../config/database';
import AdminUser from '../models/AdminUser';
import app from '../app';
import http from 'http';
import bcrypt from 'bcrypt';
import { env } from '../config/env';

async function runTests() {
  console.log('--- Testing CATALOGUE_ADMIN Permissions ---');
  await connectDatabase();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://localhost:${address.port}`;
  console.log(`Test server running at ${baseUrl}`);

  try {
    const passwordHash = await bcrypt.hash('Admin@123', env.BCRYPT_SALT_ROUNDS);

    // Ensure test users exist
    await AdminUser.deleteMany({
      email: {
        $in: [
          'test_cat_perm@extrahand.in',
          'test_seller_ops_perm@extrahand.in',
          'test_super_perm@extrahand.in',
        ],
      },
    });

    const catAdmin = await AdminUser.create({
      name: 'Test Catalogue Admin',
      email: 'test_cat_perm@extrahand.in',
      passwordHash,
      role: 'CATALOGUE_ADMIN',
      status: 'active',
      isActive: true,
    });

    const sellerOpsAdmin = await AdminUser.create({
      name: 'Test Seller Ops Admin',
      email: 'test_seller_ops_perm@extrahand.in',
      passwordHash,
      role: 'SELLER_OPERATIONS_ADMIN',
      status: 'active',
      isActive: true,
    });

    const superAdmin = await AdminUser.create({
      name: 'Test Super Admin',
      email: 'test_super_perm@extrahand.in',
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'active',
      isActive: true,
    });

    // Helper to login and get token
    async function getToken(email: string) {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Admin@123' }),
      });
      const data = (await res.json()) as any;
      if (!res.ok || !data.data?.accessToken) {
        throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
      }
      return data.data.accessToken;
    }

    const catToken = await getToken(catAdmin.email);
    const sellerOpsToken = await getToken(sellerOpsAdmin.email);
    const superToken = await getToken(superAdmin.email);

    console.log('✓ All 3 test admin accounts authenticated successfully');

    // ==========================================
    // 1. CATALOGUE_ADMIN ALLOWED ENDPOINTS
    // ==========================================
    console.log('\n--- 1. Testing CATALOGUE_ADMIN Allowed Endpoints ---');

    // Dashboard
    const dashRes = await fetch(`${baseUrl}/api/v1/admin/dashboard`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (!dashRes.ok) throw new Error(`Dashboard failed: ${dashRes.status}`);
    console.log(`✓ Dashboard: Status ${dashRes.status}`);

    // Categories
    const catRes = await fetch(`${baseUrl}/api/v1/categories`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (!catRes.ok) throw new Error(`Categories failed: ${catRes.status}`);
    console.log(`✓ Categories: Status ${catRes.status}`);

    // Subcategories
    const subRes = await fetch(`${baseUrl}/api/v1/subcategories`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (!subRes.ok) throw new Error(`Subcategories failed: ${subRes.status}`);
    console.log(`✓ Subcategories: Status ${subRes.status}`);

    // Product Types
    const ptRes = await fetch(`${baseUrl}/api/v1/product-types`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (!ptRes.ok) throw new Error(`Product Types failed: ${ptRes.status}`);
    console.log(`✓ Product Types: Status ${ptRes.status}`);

    // Attributes
    const attrRes = await fetch(`${baseUrl}/api/v1/attributes`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (!attrRes.ok) throw new Error(`Attributes failed: ${attrRes.status}`);
    console.log(`✓ Attributes: Status ${attrRes.status}`);

    // Master Products
    const mpRes = await fetch(`${baseUrl}/api/v1/master-products`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (!mpRes.ok) throw new Error(`Master Products failed: ${mpRes.status}`);
    console.log(`✓ Master Products: Status ${mpRes.status}`);

    // Product Submissions
    const psRes = await fetch(`${baseUrl}/api/v1/product-submissions`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (!psRes.ok) throw new Error(`Product Submissions failed: ${psRes.status}`);
    console.log(`✓ Product Submissions: Status ${psRes.status}`);

    // ==========================================
    // 2. CATALOGUE_ADMIN FORBIDDEN ENDPOINTS (403)
    // ==========================================
    console.log('\n--- 2. Testing CATALOGUE_ADMIN Forbidden Endpoints (Must be 403) ---');

    // Sellers List
    const sellersRes = await fetch(`${baseUrl}/api/v1/sellers`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (sellersRes.status !== 403) {
      throw new Error(`Expected 403 for /api/v1/sellers, got ${sellersRes.status}`);
    }
    console.log('✓ /api/v1/sellers blocked with 403 Forbidden');

    // Seller Approvals
    const approvalsRes = await fetch(`${baseUrl}/api/v1/sellers/approvals/list`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (approvalsRes.status !== 403) {
      throw new Error(`Expected 403 for /api/v1/sellers/approvals/list, got ${approvalsRes.status}`);
    }
    console.log('✓ /api/v1/sellers/approvals/list blocked with 403 Forbidden');

    // Seller Stores
    const storesRes = await fetch(`${baseUrl}/api/v1/sellers/stores`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (storesRes.status !== 403) {
      throw new Error(`Expected 403 for /api/v1/sellers/stores, got ${storesRes.status}`);
    }
    console.log('✓ /api/v1/sellers/stores blocked with 403 Forbidden');

    // Seller Listings (Admin endpoint)
    const listingsRes = await fetch(`${baseUrl}/api/v1/seller-listings`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (listingsRes.status !== 403) {
      throw new Error(`Expected 403 for /api/v1/seller-listings, got ${listingsRes.status}`);
    }
    console.log('✓ /api/v1/seller-listings blocked with 403 Forbidden');

    // Admin Users
    const usersRes = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (usersRes.status !== 403) {
      throw new Error(`Expected 403 for /api/v1/admin/users, got ${usersRes.status}`);
    }
    console.log('✓ /api/v1/admin/users blocked with 403 Forbidden');

    // Admin Invites
    const invitesRes = await fetch(`${baseUrl}/api/v1/admin/invites`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (invitesRes.status !== 403) {
      throw new Error(`Expected 403 for /api/v1/admin/invites, got ${invitesRes.status}`);
    }
    console.log('✓ /api/v1/admin/invites blocked with 403 Forbidden');

    // ==========================================
    // 3. SELLER_OPERATIONS_ADMIN CAN ACCESS SELLERS
    // ==========================================
    console.log('\n--- 3. Verifying SELLER_OPERATIONS_ADMIN & SUPER_ADMIN Intact ---');

    const sellerOpsAccess = await fetch(`${baseUrl}/api/v1/sellers`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (!sellerOpsAccess.ok) {
      throw new Error(`SELLER_OPERATIONS_ADMIN failed to access /api/v1/sellers: ${sellerOpsAccess.status}`);
    }
    console.log('✓ SELLER_OPERATIONS_ADMIN successfully accessed /api/v1/sellers');

    const superAdminAccess = await fetch(`${baseUrl}/api/v1/sellers`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    if (!superAdminAccess.ok) {
      throw new Error(`SUPER_ADMIN failed to access /api/v1/sellers: ${superAdminAccess.status}`);
    }
    console.log('✓ SUPER_ADMIN successfully accessed /api/v1/sellers');

    // Cleanup
    await AdminUser.deleteMany({
      email: {
        $in: [
          'test_cat_perm@extrahand.in',
          'test_seller_ops_perm@extrahand.in',
          'test_super_perm@extrahand.in',
        ],
      },
    });

    console.log('\n======================================================');
    console.log('🎉 ALL CATALOGUE_ADMIN PERMISSION TESTS PASSED 100%!');
    console.log('======================================================\n');
  } finally {
    server.close();
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

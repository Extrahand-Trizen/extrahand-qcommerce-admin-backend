import { connectDatabase } from '../config/database';
import AdminUser from '../models/AdminUser';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import app from '../app';
import http from 'http';
import bcrypt from 'bcrypt';
import { env } from '../config/env';

async function runTests() {
  console.log('--- Testing SELLER_OPERATIONS_ADMIN Permissions ---');
  await connectDatabase();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://localhost:${address.port}`;
  console.log(`Test server running at ${baseUrl}`);

  try {
    const passwordHash = await bcrypt.hash('Admin@123', env.BCRYPT_SALT_ROUNDS);

    // Ensure clean test admin users
    await AdminUser.deleteMany({
      email: {
        $in: [
          'test_seller_ops@extrahand.in',
          'test_cat_admin@extrahand.in',
          'test_super_admin@extrahand.in',
        ],
      },
    });

    const sellerOpsUser = await AdminUser.create({
      name: 'Test Seller Operations Admin',
      email: 'test_seller_ops@extrahand.in',
      passwordHash,
      role: 'SELLER_OPERATIONS_ADMIN',
      status: 'active',
      isActive: true,
    });

    const catAdminUser = await AdminUser.create({
      name: 'Test Catalogue Admin',
      email: 'test_cat_admin@extrahand.in',
      passwordHash,
      role: 'CATALOGUE_ADMIN',
      status: 'active',
      isActive: true,
    });

    const superAdminUser = await AdminUser.create({
      name: 'Test Super Admin',
      email: 'test_super_admin@extrahand.in',
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

    const sellerOpsToken = await getToken(sellerOpsUser.email);
    const catToken = await getToken(catAdminUser.email);
    const superToken = await getToken(superAdminUser.email);

    console.log('✓ All 3 test admin accounts authenticated');

    // Clean up mock sellers
    await Seller.deleteMany({ email: 'testmerchant@extrahand.in' });

    // Create a mock seller and onboarding record for testing review actions
    const uniqueId = `mock-seller-${Date.now()}`;
    const testSeller = await Seller.create({
      userId: uniqueId,
      fullName: 'Test Merchant Store',
      email: 'testmerchant@extrahand.in',
      mobileNumber: '9876543210',
      status: 'PENDING',
    });

    const testOnboarding = await SellerOnboarding.create({
      sellerId: testSeller._id,
      fullName: 'Test Merchant Store',
      mobileNumber: '9876543210',
      email: 'testmerchant@extrahand.in',
      shopName: 'Test Merchant Shop',
      shopType: 'KIRANA',
      address: '123 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      status: 'PENDING_APPROVAL',
      submittedAt: new Date(),
    });

    const sellerId = testSeller._id.toString();

    // ==========================================
    // 1. SELLER_OPERATIONS_ADMIN ALLOWED ACTIONS
    // ==========================================
    console.log('\n--- 1. Testing SELLER_OPERATIONS_ADMIN Allowed Endpoints ---');

    // A. Dashboard access
    const dashRes = await fetch(`${baseUrl}/api/v1/admin/dashboard`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (!dashRes.ok) throw new Error(`Dashboard failed with status ${dashRes.status}`);
    console.log(`✓ Dashboard: Status ${dashRes.status}`);

    // B. View seller applications (approvals list)
    const appsRes = await fetch(`${baseUrl}/api/v1/sellers/approvals/list`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (!appsRes.ok) throw new Error(`Seller applications failed with status ${appsRes.status}`);
    console.log(`✓ View seller applications: Status ${appsRes.status}`);

    // C. View seller onboarding details and documents
    const sellerDetailsRes = await fetch(`${baseUrl}/api/v1/sellers/${sellerId}`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (!sellerDetailsRes.ok) throw new Error(`View seller details failed with status ${sellerDetailsRes.status}`);
    console.log(`✓ View seller onboarding details & documents: Status ${sellerDetailsRes.status}`);

    // D. Request changes on seller application
    const changesRes = await fetch(`${baseUrl}/api/v1/sellers/${sellerId}/request-changes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerOpsToken}`,
      },
      body: JSON.stringify({ comment: 'Please re-upload business registration' }),
    });
    if (!changesRes.ok) throw new Error(`Request changes failed: ${changesRes.status}`);
    console.log(`✓ Request changes on seller application: Status ${changesRes.status}`);

    // E. Reject seller application
    const rejectRes = await fetch(`${baseUrl}/api/v1/sellers/${sellerId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerOpsToken}`,
      },
      body: JSON.stringify({ comment: 'Document verification failed' }),
    });
    if (!rejectRes.ok) throw new Error(`Reject seller failed: ${rejectRes.status}`);
    console.log(`✓ Reject seller application: Status ${rejectRes.status}`);

    // F. Approve seller application
    const approveRes = await fetch(`${baseUrl}/api/v1/sellers/${sellerId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerOpsToken}`,
      },
      body: JSON.stringify({ comment: 'All KYC verified successfully' }),
    });
    if (!approveRes.ok) throw new Error(`Approve seller failed: ${approveRes.status}`);
    console.log(`✓ Approve seller application: Status ${approveRes.status}`);

    // G. View seller users list
    const usersRes = await fetch(`${baseUrl}/api/v1/sellers`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (!usersRes.ok) throw new Error(`View seller users failed: ${usersRes.status}`);
    console.log(`✓ View seller users: Status ${usersRes.status}`);

    // H. Activate/deactivate/suspend seller accounts
    const suspendRes = await fetch(`${baseUrl}/api/v1/sellers/${sellerId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerOpsToken}`,
      },
      body: JSON.stringify({ status: 'SUSPENDED' }),
    });
    if (!suspendRes.ok) throw new Error(`Suspend seller failed: ${suspendRes.status}`);
    const suspendData = (await suspendRes.json()) as any;
    if (suspendData.data?.status !== 'SUSPENDED') throw new Error('Status not updated to SUSPENDED');
    console.log(`✓ Suspend seller account: Status ${suspendRes.status}`);

    const activateRes = await fetch(`${baseUrl}/api/v1/sellers/${sellerId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerOpsToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    if (!activateRes.ok) throw new Error(`Activate seller failed: ${activateRes.status}`);
    console.log(`✓ Activate seller account: Status ${activateRes.status}`);

    // I. View seller stores
    const storesRes = await fetch(`${baseUrl}/api/v1/sellers/stores`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (!storesRes.ok) throw new Error(`View seller stores failed: ${storesRes.status}`);
    console.log(`✓ View seller stores: Status ${storesRes.status}`);

    // ==========================================
    // 2. SELLER_OPERATIONS_ADMIN FORBIDDEN ENDPOINTS (Must return 403)
    // ==========================================
    console.log('\n--- 2. Testing SELLER_OPERATIONS_ADMIN Forbidden Endpoints (Must be 403) ---');

    // A. Catalogue: Categories
    const catRes = await fetch(`${baseUrl}/api/v1/categories`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (catRes.status !== 403) throw new Error(`Expected 403 for /api/v1/categories, got ${catRes.status}`);
    console.log('✓ /api/v1/categories blocked with 403 Forbidden');

    // B. Catalogue: Subcategories
    const subRes = await fetch(`${baseUrl}/api/v1/subcategories`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (subRes.status !== 403) throw new Error(`Expected 403 for /api/v1/subcategories, got ${subRes.status}`);
    console.log('✓ /api/v1/subcategories blocked with 403 Forbidden');

    // C. Catalogue: Product Types
    const ptRes = await fetch(`${baseUrl}/api/v1/product-types`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (ptRes.status !== 403) throw new Error(`Expected 403 for /api/v1/product-types, got ${ptRes.status}`);
    console.log('✓ /api/v1/product-types blocked with 403 Forbidden');

    // D. Catalogue: Attributes
    const attrRes = await fetch(`${baseUrl}/api/v1/attributes`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (attrRes.status !== 403) throw new Error(`Expected 403 for /api/v1/attributes, got ${attrRes.status}`);
    console.log('✓ /api/v1/attributes blocked with 403 Forbidden');

    // E. Products: Master Products
    const mpRes = await fetch(`${baseUrl}/api/v1/master-products`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (mpRes.status !== 403) throw new Error(`Expected 403 for /api/v1/master-products, got ${mpRes.status}`);
    console.log('✓ /api/v1/master-products blocked with 403 Forbidden');

    // F. Products: Product Submissions
    const psRes = await fetch(`${baseUrl}/api/v1/product-submissions`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (psRes.status !== 403) throw new Error(`Expected 403 for /api/v1/product-submissions, got ${psRes.status}`);
    console.log('✓ /api/v1/product-submissions blocked with 403 Forbidden');

    // G. Super Admin: Admin Users
    const adminUsersRes = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (adminUsersRes.status !== 403) throw new Error(`Expected 403 for /api/v1/admin/users, got ${adminUsersRes.status}`);
    console.log('✓ /api/v1/admin/users blocked with 403 Forbidden');

    // H. Super Admin: Invitations
    const adminInvitesRes = await fetch(`${baseUrl}/api/v1/admin/invites`, {
      headers: { Authorization: `Bearer ${sellerOpsToken}` },
    });
    if (adminInvitesRes.status !== 403) throw new Error(`Expected 403 for /api/v1/admin/invites, got ${adminInvitesRes.status}`);
    console.log('✓ /api/v1/admin/invites blocked with 403 Forbidden');

    // ==========================================
    // 3. VERIFY CATALOGUE_ADMIN & SUPER_ADMIN INTACT
    // ==========================================
    console.log('\n--- 3. Verifying CATALOGUE_ADMIN & SUPER_ADMIN Intact ---');

    // CATALOGUE_ADMIN accesses categories (200 OK)
    const catCheckRes = await fetch(`${baseUrl}/api/v1/categories`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (!catCheckRes.ok) throw new Error(`CATALOGUE_ADMIN failed /api/v1/categories: ${catCheckRes.status}`);
    console.log('✓ CATALOGUE_ADMIN successfully accessed /api/v1/categories');

    // CATALOGUE_ADMIN blocked from sellers (403 Forbidden)
    const catBlockedSellers = await fetch(`${baseUrl}/api/v1/sellers`, {
      headers: { Authorization: `Bearer ${catToken}` },
    });
    if (catBlockedSellers.status !== 403) throw new Error(`Expected 403 for CATALOGUE_ADMIN on /api/v1/sellers, got ${catBlockedSellers.status}`);
    console.log('✓ CATALOGUE_ADMIN blocked from /api/v1/sellers with 403');

    // SUPER_ADMIN accesses sellers (200 OK)
    const superCheckSellers = await fetch(`${baseUrl}/api/v1/sellers`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    if (!superCheckSellers.ok) throw new Error(`SUPER_ADMIN failed /api/v1/sellers: ${superCheckSellers.status}`);
    console.log('✓ SUPER_ADMIN successfully accessed /api/v1/sellers');

    // SUPER_ADMIN accesses categories (200 OK)
    const superCheckCategories = await fetch(`${baseUrl}/api/v1/categories`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    if (!superCheckCategories.ok) throw new Error(`SUPER_ADMIN failed /api/v1/categories: ${superCheckCategories.status}`);
    console.log('✓ SUPER_ADMIN successfully accessed /api/v1/categories');

    // SUPER_ADMIN accesses admin users (200 OK)
    const superCheckAdminUsers = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    if (!superCheckAdminUsers.ok) throw new Error(`SUPER_ADMIN failed /api/v1/admin/users: ${superCheckAdminUsers.status}`);
    console.log('✓ SUPER_ADMIN successfully accessed /api/v1/admin/users');

    // Cleanup test data
    await Seller.findByIdAndDelete(testSeller._id);
    await SellerOnboarding.findByIdAndDelete(testOnboarding._id);
    await AdminUser.deleteMany({
      email: {
        $in: [
          'test_seller_ops@extrahand.in',
          'test_cat_admin@extrahand.in',
          'test_super_admin@extrahand.in',
        ],
      },
    });

    console.log('\n=============================================================');
    console.log('🎉 ALL SELLER_OPERATIONS_ADMIN PERMISSION TESTS PASSED 100%!');
    console.log('=============================================================\n');
    server.close();
    process.exit(0);
  } catch (err) {
    server.close();
    throw err;
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

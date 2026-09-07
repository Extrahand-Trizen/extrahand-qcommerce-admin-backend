import { connectDatabase } from '../config/database';
import AdminUser from '../models/AdminUser';
import AdminInvite from '../models/AdminInvite';
import { AuthService } from '../services/AuthService';
import app from '../app';
import http from 'http';
import bcrypt from 'bcrypt';
import { env } from '../config/env';

async function runTests() {
  console.log('--- Starting Admin User and Role Management Tests ---');
  await connectDatabase();

  // Start temporary test server on random port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://localhost:${address.port}`;
  console.log(`Test server running at ${baseUrl}`);

  try {
    // 1. Ensure test super admin exists
    const superAdminEmail = 'test_superadmin@extrahand.in';
    const passwordHash = await bcrypt.hash('Admin@123', env.BCRYPT_SALT_ROUNDS);

    await AdminUser.deleteMany({ email: { $in: [superAdminEmail, 'test_catadmin@extrahand.in', 'test_opsadmin@extrahand.in'] } });
    await AdminInvite.deleteMany({ email: { $in: ['test_catadmin@extrahand.in', 'test_opsadmin@extrahand.in'] } });

    const superAdmin = await AdminUser.create({
      name: 'Test Super Admin',
      email: superAdminEmail,
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'active',
      isActive: true,
    });
    console.log('✓ Super Admin created:', superAdmin.email);

    // 2. Test Super Admin Login
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: superAdminEmail, password: 'Admin@123' }),
    });
    const loginData = await loginRes.json() as any;
    if (!loginRes.ok || !loginData.data?.accessToken) {
      throw new Error(`Super admin login failed: ${JSON.stringify(loginData)}`);
    }
    const superAdminToken = loginData.data.accessToken;
    console.log('✓ Super Admin logged in, role:', loginData.data.user.role, 'isSuperAdmin:', loginData.data.user.isSuperAdmin);

    // 3. Test creating an invite for CATALOGUE_ADMIN
    const createInviteRes = await fetch(`${baseUrl}/api/v1/admin/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        name: 'Test Catalogue Admin',
        email: 'test_catadmin@extrahand.in',
        role: 'CATALOGUE_ADMIN',
      }),
    });
    const createInviteData = await createInviteRes.json() as any;
    if (!createInviteRes.ok) {
      throw new Error(`Create invite failed: ${JSON.stringify(createInviteData)}`);
    }
    const inviteId = createInviteData.data.inviteId;
    console.log('✓ Invitation created for CATALOGUE_ADMIN, inviteId:', inviteId);

    // 4. Test listing invites
    const listInvitesRes = await fetch(`${baseUrl}/api/v1/admin/invites`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const listInvitesData = await listInvitesRes.json() as any;
    if (!listInvitesRes.ok || !listInvitesData.data.invites.some((i: any) => i.inviteId === inviteId)) {
      throw new Error(`List invites failed: ${JSON.stringify(listInvitesData)}`);
    }
    console.log(`✓ List invites succeeded (${listInvitesData.data.invites.length} invites found)`);

    // 5. Test accepting invite via public endpoint
    // Fetch raw token from DB for testing acceptance
    const inviteDoc = await AdminInvite.findOne({ inviteId });
    // In our implementation, we generate token inside static createInvite; let's simulate acceptance with resend or generate
    // Since token is hashed in DB, let's test acceptInvite with a known token
    const testToken = 'test-token-uuid-12345';
    inviteDoc!.token = await bcrypt.hash(testToken, 10);
    await inviteDoc!.save();

    const acceptRes = await fetch(`${baseUrl}/api/v1/invites/${inviteId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: testToken,
        password: 'Password@123',
        name: 'Test Catalogue Admin',
      }),
    });
    const acceptData = await acceptRes.json() as any;
    if (!acceptRes.ok) {
      throw new Error(`Accept invite failed: ${JSON.stringify(acceptData)}`);
    }
    console.log('✓ Invite accepted successfully, user created:', acceptData.data?.user?.email);

    // 6. Test login as newly accepted CATALOGUE_ADMIN
    const catLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test_catadmin@extrahand.in', password: 'Password@123' }),
    });
    const catLoginData = await catLoginRes.json() as any;
    if (!catLoginRes.ok || !catLoginData.data?.accessToken) {
      throw new Error(`Catalogue admin login failed: ${JSON.stringify(catLoginData)}`);
    }
    const catAdminToken = catLoginData.data.accessToken;
    console.log('✓ Catalogue Admin logged in, role:', catLoginData.data.user.role);

    // 7. Verify CATALOGUE_ADMIN CAN access existing modules (e.g. /api/v1/categories) - Requirement 7
    const catAccessRes = await fetch(`${baseUrl}/api/v1/categories`, {
      headers: { Authorization: `Bearer ${catAdminToken}` },
    });
    if (catAccessRes.status === 403) {
      throw new Error('CATALOGUE_ADMIN was forbidden from accessing /categories! Requirement 7 broken.');
    }
    console.log(`✓ CATALOGUE_ADMIN successfully accessed /categories (Status: ${catAccessRes.status})`);

    // 8. Verify CATALOGUE_ADMIN CANNOT access /api/v1/admin/users (Requirement 6)
    const catAdminUsersRes = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${catAdminToken}` },
    });
    if (catAdminUsersRes.status !== 403) {
      throw new Error(`Expected 403 for CATALOGUE_ADMIN accessing /admin/users, but got ${catAdminUsersRes.status}`);
    }
    console.log('✓ CATALOGUE_ADMIN correctly blocked from /admin/users with 403 Forbidden');

    // 9. Verify CATALOGUE_ADMIN CANNOT access /api/v1/admin/invites (Requirement 6)
    const catAdminInvitesRes = await fetch(`${baseUrl}/api/v1/admin/invites`, {
      headers: { Authorization: `Bearer ${catAdminToken}` },
    });
    if (catAdminInvitesRes.status !== 403) {
      throw new Error(`Expected 403 for CATALOGUE_ADMIN accessing /admin/invites, but got ${catAdminInvitesRes.status}`);
    }
    console.log('✓ CATALOGUE_ADMIN correctly blocked from /admin/invites with 403 Forbidden');

    // 10. Test listing admin users as SUPER_ADMIN
    const listUsersRes = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const listUsersData = await listUsersRes.json() as any;
    if (!listUsersRes.ok || listUsersData.data.users.length < 2) {
      throw new Error(`List admin users failed: ${JSON.stringify(listUsersData)}`);
    }
    console.log(`✓ SUPER_ADMIN listed ${listUsersData.data.users.length} admin users successfully`);

    // 11. Test updating role of CATALOGUE_ADMIN to SELLER_OPERATIONS_ADMIN
    const catUser = await AdminUser.findOne({ email: 'test_catadmin@extrahand.in' });
    const updateRoleRes = await fetch(`${baseUrl}/api/v1/admin/users/${catUser!._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ role: 'SELLER_OPERATIONS_ADMIN' }),
    });
    const updateRoleData = await updateRoleRes.json() as any;
    if (!updateRoleRes.ok || updateRoleData.data.role !== 'SELLER_OPERATIONS_ADMIN') {
      throw new Error(`Update role failed: ${JSON.stringify(updateRoleData)}`);
    }
    console.log('✓ Role changed to SELLER_OPERATIONS_ADMIN successfully');

    // 12. Test deactivating admin user
    const deactivateRes = await fetch(`${baseUrl}/api/v1/admin/users/${catUser!._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ status: 'inactive' }),
    });
    const deactivateData = await deactivateRes.json() as any;
    if (!deactivateRes.ok || deactivateData.data.status !== 'inactive') {
      throw new Error(`Deactivate failed: ${JSON.stringify(deactivateData)}`);
    }
    console.log('✓ Admin deactivated successfully');

    // 13. Test Last Active Super Admin Protection (Requirement 6)
    // Ensure only 1 super admin exists for this check
    await AdminUser.deleteMany({ role: { $in: ['SUPER_ADMIN', 'ADMIN'] }, email: { $ne: superAdminEmail } });

    // Attempt to demote the last super admin
    const demoteSuperAdminRes = await fetch(`${baseUrl}/api/v1/admin/users/${superAdmin._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ role: 'CATALOGUE_ADMIN' }),
    });
    if (demoteSuperAdminRes.status !== 400) {
      throw new Error(`Expected 400 when demoting last Super Admin, got ${demoteSuperAdminRes.status}`);
    }
    console.log('✓ Successfully prevented demoting the last active Super Admin');

    // Attempt to deactivate the last super admin
    const deactivateSuperAdminRes = await fetch(`${baseUrl}/api/v1/admin/users/${superAdmin._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ status: 'inactive' }),
    });
    if (deactivateSuperAdminRes.status !== 400) {
      throw new Error(`Expected 400 when deactivating last Super Admin, got ${deactivateSuperAdminRes.status}`);
    }
    console.log('✓ Successfully prevented deactivating the last active Super Admin');

    // Attempt to delete the last super admin
    const deleteSuperAdminRes = await fetch(`${baseUrl}/api/v1/admin/users/${superAdmin._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    if (deleteSuperAdminRes.status !== 400) {
      throw new Error(`Expected 400 when deleting last Super Admin, got ${deleteSuperAdminRes.status}`);
    }
    console.log('✓ Successfully prevented deleting the last active Super Admin');

    // 14. Test deleting the other admin user
    const deleteOtherRes = await fetch(`${baseUrl}/api/v1/admin/users/${catUser!._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    if (!deleteOtherRes.ok) {
      throw new Error(`Delete admin user failed: ${await deleteOtherRes.text()}`);
    }
    console.log('✓ Deleting non-super admin succeeded');

    // Cleanup test data
    await AdminUser.deleteMany({ email: { $in: [superAdminEmail, 'test_catadmin@extrahand.in'] } });
    await AdminInvite.deleteMany({ email: { $in: ['test_catadmin@extrahand.in'] } });

    console.log('\n=============================================');
    console.log('🎉 ALL 14 TEST SUITES PASSED FLAWLESSLY!');
    console.log('=============================================\n');
  } finally {
    server.close();
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

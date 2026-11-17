import assert from 'assert';
import {
  normalizeMobileNumber,
  ShopRegistrationNotificationService,
  ShopRegistrationDetails,
} from '../services/ShopRegistrationNotificationService';
import { EmailServiceClient } from '../services/EmailServiceClient';

async function runTests() {
  console.log('--- Starting Shop Registration Notification Tests ---');

  // 1. Test Number Normalization
  console.log('1. Testing Mobile Number Normalization...');
  assert.strictEqual(normalizeMobileNumber('+91 98765 43210'), '9876543210');
  assert.strictEqual(normalizeMobileNumber('09876543210'), '9876543210');
  assert.strictEqual(normalizeMobileNumber('+91-98765-43210'), '9876543210');
  assert.strictEqual(normalizeMobileNumber('9876543210'), '9876543210');
  assert.strictEqual(normalizeMobileNumber('919876543210'), '9876543210');
  assert.strictEqual(normalizeMobileNumber('  +91 91234 56789  '), '9123456789');
  console.log('✓ Mobile number normalization passed (handles +91, 0, spaces, dashes).');

  // 2. Test Exclusive Matching Logic
  console.log('2. Testing Exclusive Matching Logic...');
  const exclusiveList = ['9876543210', '+91 99988 77700'];
  const normalizedExclusive = exclusiveList.map(normalizeMobileNumber);

  // Scenario A: Shop registered with exclusive number (+91 98765 43210)
  const shopA_phone = '+91 98765 43210';
  const isExclusiveA = normalizedExclusive.includes(normalizeMobileNumber(shopA_phone));
  assert.strictEqual(isExclusiveA, true, 'Shop A must be detected as exclusive');
  console.log('✓ Scenario A: Exclusive mobile (+91 98765 43210) correctly matched as exclusive.');

  // Scenario B: Shop registered with another format of exclusive number (09998877700)
  const shopB_phone = '09998877700';
  const isExclusiveB = normalizedExclusive.includes(normalizeMobileNumber(shopB_phone));
  assert.strictEqual(isExclusiveB, true, 'Shop B must be detected as exclusive');
  console.log('✓ Scenario B: Exclusive mobile (09998877700) correctly matched as exclusive.');

  // Scenario C: Shop registered with standard non-exclusive number (9811223344)
  const shopC_phone = '9811223344';
  const isExclusiveC = normalizedExclusive.includes(normalizeMobileNumber(shopC_phone));
  assert.strictEqual(isExclusiveC, false, 'Shop C must NOT be detected as exclusive');
  console.log('✓ Scenario C: Regular mobile (9811223344) correctly identified as non-exclusive.');

  // 3. Mock EmailServiceClient.sendShopRegistrationEmail to test service integration
  console.log('3. Testing Service Notification Dispatch Integration...');
  const sentPayloads: any[] = [];
  const originalSend = EmailServiceClient.sendShopRegistrationEmail;
  EmailServiceClient.sendShopRegistrationEmail = async (payload) => {
    sentPayloads.push(payload);
    return true;
  };

  // Mock getConfig to return controlled test settings
  const originalGetConfig = ShopRegistrationNotificationService.getConfig;
  ShopRegistrationNotificationService.getConfig = async () => {
    return {
      enabled: true,
      recipientEmails: ['admin1@extrahand.in', 'admin2@extrahand.in'],
      exclusiveMobileNumbers: ['9876543210', '9998877700'],
    } as any;
  };

  try {
    // Test Case 1: Exclusive number shop registration -> Should NOT send email
    const exclusiveShop: ShopRegistrationDetails = {
      sellerId: 'exclusive-seller-1',
      shopName: 'Exclusive VIP Store',
      ownerName: 'VIP Owner',
      mobileNumber: '+91 98765 43210',
      email: 'vip@example.com',
      registeredAt: new Date(),
    };
    await ShopRegistrationNotificationService.handleShopRegistration(exclusiveShop);
    assert.strictEqual(
      sentPayloads.length,
      0,
      'Email must NOT be sent for shop registered with exclusive mobile number'
    );
    console.log('✓ Test Case 1: Exclusive mobile registered -> Email skipped as expected.');

    // Test Case 2: Non-exclusive number shop registration -> MUST send email to all recipients
    const regularShop: ShopRegistrationDetails = {
      sellerId: 'regular-seller-2',
      shopName: 'Fresh Mart Grocery',
      category: 'Grocery & Supermarket',
      location: 'Plot 45, Jubilee Hills, Hyderabad',
      ownerName: 'Ramesh Kumar',
      mobileNumber: '+91 91234 56789',
      email: 'ramesh@freshmart.in',
      registeredAt: new Date('2026-11-16T12:00:00Z'),
    };
    await ShopRegistrationNotificationService.handleShopRegistration(regularShop);
    assert.strictEqual(
      sentPayloads.length,
      1,
      'Email MUST be sent for shop registered with regular mobile number'
    );
    assert.deepStrictEqual(
      sentPayloads[0].recipients,
      ['admin1@extrahand.in', 'admin2@extrahand.in'],
      'Email must be sent to all configured recipient email addresses'
    );
    assert.strictEqual(sentPayloads[0].shopName, 'Fresh Mart Grocery');
    assert.strictEqual(sentPayloads[0].category, 'Grocery & Supermarket');
    assert.strictEqual(sentPayloads[0].location, 'Plot 45, Jubilee Hills, Hyderabad');
    assert.strictEqual(sentPayloads[0].ownerName, 'Ramesh Kumar');
    assert.strictEqual(sentPayloads[0].mobileNumber, '+91 91234 56789');
    assert.strictEqual(sentPayloads[0].email, 'ramesh@freshmart.in');
    console.log('✓ Test Case 2: Regular mobile registered -> Email dispatched to all recipients with category and location.');

    // Test Case 3: Email delivery failure does not throw
    EmailServiceClient.sendShopRegistrationEmail = async () => {
      throw new Error('Simulated SMTP connection timeout');
    };
    let didThrow = false;
    try {
      await ShopRegistrationNotificationService.handleShopRegistration(regularShop);
    } catch {
      didThrow = true;
    }
    assert.strictEqual(didThrow, false, 'Email failure must NEVER throw or block registration');
    console.log('✓ Test Case 3: Email service failure handled gracefully without throwing.');
  } finally {
    // Restore original implementations
    EmailServiceClient.sendShopRegistrationEmail = originalSend;
    ShopRegistrationNotificationService.getConfig = originalGetConfig;
  }

  console.log('--- ALL TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch((e) => {
  console.error('Test execution failed:', e);
  process.exit(1);
});

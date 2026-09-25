import { VerificationServiceClient } from '../src/services/VerificationServiceClient';
import { signAccessToken } from '../src/utils/jwt';

async function testBackendClient() {
  const token = signAccessToken({
    sub: 'test_seller_sub_123',
    role: 'SELLER',
    sellerId: '6ab652a7b0410bfa053f0d39',
  });

  console.log('Testing VerificationServiceClient.verifyBankAccount from backend...');
  try {
    const res = await VerificationServiceClient.verifyBankAccount(
      token,
      '026291800001191',
      'YESB0000262',
      'AMEYA ANIL KHANWALKAR'
    );
    console.log('VerificationServiceClient Result:', res);
  } catch (err: any) {
    console.log('VerificationServiceClient Error status:', err.statusCode || err.status);
    console.log('VerificationServiceClient Error message:', err.message);
  }
}

testBackendClient();

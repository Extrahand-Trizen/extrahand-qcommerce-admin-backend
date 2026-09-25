import { signAccessToken } from '../src/utils/jwt';
import http from 'http';

async function run() {
  const token = signAccessToken({
    sub: 'admin1',
    role: 'SUPER_ADMIN',
    email: 'admin@extrahand.in',
    name: 'Super Admin',
  });

  return new Promise<void>((resolve, reject) => {
    const req = http.request(
      'http://127.0.0.1:4010/api/v1/sellers/6ab64131ac6edb729157f09d',
      {
        headers: { Authorization: 'Bearer ' + token },
      },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          console.log('HTTP Status:', res.statusCode);
          const parsed = JSON.parse(body);
          console.log('Returned Onboarding in Admin API:');
          console.log('  Shop Name:', parsed.data?.onboarding?.shopName);
          console.log('  Aadhaar Number:', parsed.data?.onboarding?.aadhaarNumber);
          console.log('  Aadhaar Verification Status:', parsed.data?.onboarding?.aadhaarVerificationStatus);
          console.log('  Bank Account:', JSON.stringify(parsed.data?.onboarding?.bankAccount, null, 2));
          resolve();
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

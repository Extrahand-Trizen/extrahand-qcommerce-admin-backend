import jwt from 'jsonwebtoken';
import http from 'http';
import { env } from '../src/config/env';

async function testApi() {
  const token = jwt.sign(
    { sub: 'test-admin', role: 'SUPER_ADMIN', email: 'admin@extrahand.in' },
    env.JWT_SECRET
  );

  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: 4010,
      path: '/api/v1/subcategories?limit=8',
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
      },
    },
    (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        console.log('HTTP Status:', res.statusCode);
        const json = JSON.parse(data);
        console.log('Total subcategories available in Admin API:', json.data?.total);
        console.log('Sample Items:');
        for (const item of json.data?.items || []) {
          console.log(`- ${item.name} | Category: ${item.categoryId?.name} | Order: ${item.displayOrder} | Status: ${item.status}`);
        }
      });
    }
  );

  req.on('error', (err) => console.error(err));
  req.end();
}

testApi();

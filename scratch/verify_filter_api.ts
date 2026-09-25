import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import http from 'http';
import { env } from '../src/config/env';

async function testFilter() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri, { dbName: 'extrahand' });

  const testCategories = ['Grocery & Staples', 'Dairy, Bread & Eggs', 'Pet Supplies', 'Pooja & Religious'];
  const token = jwt.sign(
    { sub: 'test-admin', role: 'SUPER_ADMIN', email: 'admin@extrahand.in' },
    env.JWT_SECRET
  );

  for (const catName of testCategories) {
    const cat = await mongoose.connection.collection('categories').findOne({ name: catName });
    if (!cat) continue;

    await new Promise<void>((resolve) => {
      http.get(
        {
          hostname: '127.0.0.1',
          port: 4010,
          path: `/api/v1/subcategories?categoryId=${cat._id}&limit=50`,
          headers: { Authorization: 'Bearer ' + token },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            const json = JSON.parse(data);
            console.log(`\n[${cat.name}] has ${json.data?.total} subcategories:`);
            console.log(json.data?.items?.map((i: any) => `${i.name} (order ${i.displayOrder})`).join(' | '));
            resolve();
          });
        }
      );
    });
  }

  await mongoose.disconnect();
}

testFilter().catch(console.error);

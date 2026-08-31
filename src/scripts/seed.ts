import bcrypt from 'bcrypt';
import { connectDatabase } from '../config/database';
import AdminUser from '../models/AdminUser';
import { env } from '../config/env';

async function seed() {
  await connectDatabase();
  const email = 'admin@extrahand.in';
  const passwordHash = await bcrypt.hash('Admin@123', env.BCRYPT_SALT_ROUNDS);

  const user = await AdminUser.findOneAndUpdate(
    { email },
    {
      name: 'QC Admin',
      email,
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
    { upsert: true, new: true }
  );

  console.log('QC admin ready:', user.email, '/ Admin@123');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

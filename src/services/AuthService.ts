import bcrypt from 'bcrypt';
import AdminUser from '../models/AdminUser';
import { env } from '../config/env';
import { signAccessToken, signRefreshToken } from '../utils/jwt';
import { AppError } from '../utils/response';

export class AuthService {
  static async login(email: string, password: string) {
    const user = await AdminUser.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    if (!user || (!user.isActive && user.status !== 'active')) throw new AppError('Invalid credentials', 401);
    if (user.status === 'suspended') throw new AppError('Your account has been suspended', 403);
    const valid = await user.comparePassword(password);
    if (!valid) throw new AppError('Invalid credentials', 401);

    user.lastLoginAt = new Date();
    await user.save();

    const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
    const payload = { sub: user._id.toString(), email: user.email, name: user.name, role: user.role };
    return {
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken({ sub: user._id.toString() }),
      user: {
        id: user._id,
        userId: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status || (user.isActive ? 'active' : 'inactive'),
        isSuperAdmin,
      },
    };
  }

  static async register(name: string, email: string, password: string) {
    const existing = await AdminUser.findOne({ email: email.toLowerCase() });
    if (existing) throw new AppError('Email already registered', 409);
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
    const user = await AdminUser.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: 'CATALOGUE_ADMIN',
      status: 'active',
      isActive: true,
    });
    return {
      id: user._id,
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
    };
  }

  static async getMe(userId: string) {
    const user = await AdminUser.findById(userId);
    if (!user || (!user.isActive && user.status !== 'active')) throw new AppError('User not found or inactive', 404);
    const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
    return {
      id: user._id,
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status || (user.isActive ? 'active' : 'inactive'),
      isSuperAdmin,
    };
  }
}

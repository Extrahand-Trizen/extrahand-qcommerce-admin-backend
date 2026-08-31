import { Router, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthService } from '../services/AuthService';
import { SellerOtpService } from '../services/SellerOtpService';
import { AuthRequest, authenticate } from '../middleware/auth';
import { success, error } from '../utils/response';
import { env } from '../config/env';

const router = Router();

function issueSellerToken(mobileNumber: string) {
  const userId = `seller_${mobileNumber}`;
  const token = jwt.sign(
    { sub: userId, sid: `seller-session-${mobileNumber}` },
    env.ACCESS_TOKEN_SECRET!,
    {
      issuer: env.TOKEN_ISSUER,
      audience: env.TOKEN_AUDIENCE,
      expiresIn: '30d',
    } as jwt.SignOptions
  );
  return { token, userId, mobileNumber };
}

router.post('/seller/send-otp', async (req, res, next) => {
  try {
    const { mobileNumber } = req.body as { mobileNumber?: string };
    if (!mobileNumber || !/^\d{10}$/.test(mobileNumber)) {
      return error(res, 'Valid 10-digit mobile number required', 400);
    }
    return success(res, SellerOtpService.sendOtp(mobileNumber));
  } catch (e) {
    next(e);
  }
});

router.post('/seller/verify-otp', async (req, res, next) => {
  try {
    const { mobileNumber, otp } = req.body as { mobileNumber?: string; otp?: string };
    if (!mobileNumber || !/^\d{10}$/.test(mobileNumber)) {
      return error(res, 'Valid 10-digit mobile number required', 400);
    }
    if (!otp || !/^\d{6}$/.test(otp)) {
      return error(res, 'Valid 6-digit OTP required', 400);
    }
    if (!env.ACCESS_TOKEN_SECRET) {
      return error(res, 'Seller authentication is not configured', 503);
    }

    SellerOtpService.verifyOtp(mobileNumber, otp);
    return success(res, issueSellerToken(mobileNumber));
  } catch (e) {
    next(e);
  }
});

/** Legacy seller login — kept for internal testing without OTP. */
router.post('/seller/login', async (req, res, next) => {
  try {
    const { mobileNumber, fullName } = req.body as { mobileNumber?: string; fullName?: string };
    if (!mobileNumber || !/^\d{10}$/.test(mobileNumber)) {
      return error(res, 'Valid 10-digit mobile number required', 400);
    }
    if (!env.ACCESS_TOKEN_SECRET) {
      return error(res, 'Seller authentication is not configured', 503);
    }

    return success(res, {
      ...issueSellerToken(mobileNumber),
      fullName: fullName?.trim() || undefined,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return error(res, 'Email and password required', 400);
    const result = await AuthService.login(email, password);
    return success(res, result);
  } catch (e) { next(e); }
});

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return error(res, 'Name, email and password required', 400);
    const user = await AuthService.register(name, email, password);
    return success(res, user, 201);
  } catch (e) { next(e); }
});

router.get('/me', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await AuthService.getMe(req.user!.sub);
    return success(res, user);
  } catch (e) { next(e); }
});

export default router;

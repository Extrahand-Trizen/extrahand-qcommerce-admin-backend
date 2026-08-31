import { env } from '../config/env';
import { AppError } from '../utils/response';

interface OtpRecord {
  otp: string;
  expiresAt: number;
}

const otpStore = new Map<string, OtpRecord>();

const OTP_TTL_MS = 5 * 60 * 1000;

export class SellerOtpService {
  static sendOtp(mobileNumber: string) {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(mobileNumber, { otp, expiresAt: Date.now() + OTP_TTL_MS });

    if (env.NODE_ENV !== 'production') {
      console.log(`[Seller OTP] +91${mobileNumber}: ${otp}`);
    }

    return {
      message: 'OTP sent successfully',
      expiresInSeconds: OTP_TTL_MS / 1000,
      ...(env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
    };
  }

  static verifyOtp(mobileNumber: string, otp: string) {
    const record = otpStore.get(mobileNumber);
    if (!record) throw new AppError('OTP expired or not found. Request a new one.', 400);
    if (record.expiresAt < Date.now()) {
      otpStore.delete(mobileNumber);
      throw new AppError('OTP expired. Request a new one.', 400);
    }
    if (record.otp !== otp.trim()) throw new AppError('Invalid OTP', 400);
    otpStore.delete(mobileNumber);
    return true;
  }
}

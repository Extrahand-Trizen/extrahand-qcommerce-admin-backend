import { Router, Response, NextFunction } from 'express';
import { AuthRequest, requireSeller } from '../middleware/auth';
import { success } from '../utils/response';
import { SellerStoreSettingsService } from '../services/SellerStoreSettingsService';
import { SellerService } from '../services/SellerService';

const router = Router();

/* -------- store settings: open/closed, hours -------- */

// GET /api/v1/seller/store-settings
router.get('/store-settings', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerStoreSettingsService.getForSeller(req.user!.sellerId!));
  } catch (e) { next(e); }
});

// PATCH /api/v1/seller/store-settings  { storeStatus?, statusMode?, openTime?, closeTime?, daysOpen? }
router.patch('/store-settings', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerStoreSettingsService.update(req.user!.sellerId!, req.body));
  } catch (e) { next(e); }
});

// PUT /api/v1/seller/store-settings/bank-account  { accountHolderName, accountNumber, ifscCode, bankName?, upiId? }
router.put('/store-settings/bank-account', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerStoreSettingsService.setBankAccount(req.user!.sellerId!, req.body));
  } catch (e) { next(e); }
});

/* -------- editable shop profile (non-legal fields) -------- */

// PATCH /api/v1/seller/profile/contact  { shopDescription?, shopMobileNumber?, shopEmail?, landmark? }
router.patch('/profile/contact', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerService.updateContact(req.user!.sellerId!, req.body));
  } catch (e) { next(e); }
});

export default router;

import { Router, Response, NextFunction } from 'express';
import { AuthRequest, requireSeller } from '../middleware/auth';
import { success } from '../utils/response';
import { SellerStoreSettingsService } from '../services/SellerStoreSettingsService';
import { SellerService } from '../services/SellerService';
import { uploadImage } from '../middleware/upload';
import { uploadFile } from '../utils/storage';
import { resolvePublicAssetUrl } from '../utils/media';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerDocument from '../models/SellerDocument';

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

// PUT /api/v1/seller/store-settings/bank-account  { accountHolderName, accountNumber, ifscCode, bankName?, upiId?, passbookImageUrl? }
router.put('/store-settings/bank-account', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerStoreSettingsService.setBankAccount(req.user!.sellerId!, req.body));
  } catch (e) { next(e); }
});

// POST /api/v1/seller/store-settings/bank-account/photo  (multipart "image" | "photo" | "document" | "file" | "passbook") -> { imageUrl, photoUrl }
router.post(
  '/store-settings/bank-account/photo',
  ...requireSeller,
  uploadImage.fields([
    { name: 'image', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'document', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'passbook', maxCount: 1 },
  ]),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const filesMap = req.files as Record<string, Express.Multer.File[]> | undefined;
      const file =
        req.file ||
        filesMap?.image?.[0] ||
        filesMap?.photo?.[0] ||
        filesMap?.document?.[0] ||
        filesMap?.file?.[0] ||
        filesMap?.passbook?.[0];

      if (!file) return res.status(400).json({ success: false, error: 'No bank book / passbook image provided' });
      const sellerId = req.user!.sellerId!;
      const onboarding = await SellerOnboarding.findOne({ sellerId });

      const result = await uploadFile(file, 'bank-documents');

      // Mirror into SellerDocument ledger if onboarding exists
      if (onboarding) {
        const existing = await SellerDocument.findOne({
          sellerId,
          documentType: 'BANK_PASSBOOK',
        });
        if (existing) {
          existing.onboardingId = onboarding._id;
          existing.fileUrl = result.url;
          existing.fileName = result.fileName;
          existing.mimeType = result.mimeType;
          existing.fileSize = result.fileSize;
          existing.verificationStatus = 'PENDING';
          await existing.save();
        } else {
          await SellerDocument.create({
            sellerId,
            onboardingId: onboarding._id,
            documentType: 'BANK_PASSBOOK',
            fileUrl: result.url,
            fileName: result.fileName,
            mimeType: result.mimeType,
            fileSize: result.fileSize,
            verificationStatus: 'PENDING',
            uploadedAt: new Date(),
          });
        }
      }

      const publicUrl = resolvePublicAssetUrl(result.url);
      return success(res, { imageUrl: publicUrl, photoUrl: publicUrl, rawUrl: result.url }, 201);
    } catch (e) { next(e); }
  },
);

/* -------- editable shop profile (non-legal fields) -------- */

// PATCH /api/v1/seller/profile/contact  { shopDescription?, shopMobileNumber?, shopEmail?, landmark?, shopImageUrl? }
router.patch('/profile/contact', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerService.updateContact(req.user!.sellerId!, req.body));
  } catch (e) { next(e); }
});

// POST /api/v1/seller/profile/photo  (multipart "image" | "photo" | "document" | "file") -> { imageUrl, photoUrl }
router.post(
  '/profile/photo',
  ...requireSeller,
  uploadImage.fields([
    { name: 'image', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'document', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const filesMap = req.files as Record<string, Express.Multer.File[]> | undefined;
      const file =
        req.file ||
        filesMap?.image?.[0] ||
        filesMap?.photo?.[0] ||
        filesMap?.document?.[0] ||
        filesMap?.file?.[0];

      if (!file) return res.status(400).json({ success: false, error: 'No image provided' });
      const sellerId = req.user!.sellerId!;
      const onboarding = await SellerOnboarding.findOne({ sellerId });
      if (!onboarding) {
        return res.status(400).json({ success: false, error: 'Complete shop registration first' });
      }

      const result = await uploadFile(file, 'shop-images');
      onboarding.shopImageUrl = result.url;
      await onboarding.save();

      // Mirror into SellerDocument for document ledger
      const existing = await SellerDocument.findOne({
        sellerId,
        documentType: 'SHOP_IMAGE',
      });
      if (existing) {
        existing.onboardingId = onboarding._id;
        existing.fileUrl = result.url;
        existing.fileName = result.fileName;
        existing.mimeType = result.mimeType;
        existing.fileSize = result.fileSize;
        await existing.save();
      } else {
        await SellerDocument.create({
          sellerId,
          onboardingId: onboarding._id,
          documentType: 'SHOP_IMAGE',
          fileUrl: result.url,
          fileName: result.fileName,
          mimeType: result.mimeType,
          fileSize: result.fileSize,
          verificationStatus: 'PENDING',
          uploadedAt: new Date(),
        });
      }

      const publicUrl = resolvePublicAssetUrl(result.url);
      return success(res, { imageUrl: publicUrl, photoUrl: publicUrl, rawUrl: result.url }, 201);
    } catch (e) { next(e); }
  },
);

/* -------- delete store (seller-facing, irreversible) -------- */

// DELETE /api/v1/seller/store  { confirm: true, reason? }
// Soft-deletes the Seller row, hard-deletes every store-scoped collection
// (including this store's orders), removes uploaded assets, and asks the
// user-service / notification-service to drop the seller role + its
// notifications. Blocks with 409 while in-flight orders exist.
router.delete('/store', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await SellerService.deleteOwnStore(req.user!.sellerId!, {
      confirm: req.body?.confirm === true,
      reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
    });
    return success(res, result);
  } catch (e) { next(e); }
});

export default router;

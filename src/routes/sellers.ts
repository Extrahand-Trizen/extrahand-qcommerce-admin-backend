import { Router, Response, NextFunction } from 'express';
import { SellerService } from '../services/SellerService';
import { AuthRequest, requireAdmin, requireSeller, requireSellerAdmin, authenticate } from '../middleware/auth';
import { success } from '../utils/response';
import { fetchVerifiedProfile } from '../utils/userProfile';
import { uploadDocument } from '../middleware/upload';
import { uploadFile } from '../utils/storage';
import SellerDocument from '../models/SellerDocument';
import SellerOnboarding from '../models/SellerOnboarding';

const router = Router();
// Admin-facing seller management endpoints — only SUPER_ADMIN and SELLER_OPERATIONS_ADMIN.
const admin = requireSellerAdmin;

// Admin: list all sellers
router.get('/', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.listSellers(req.query as never)); } catch (e) { next(e); }
});

// Admin: approvals (must be registered before /:id)
router.get('/approvals/list', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.listApprovals(req.query as never)); } catch (e) { next(e); }
});

// Admin: approved seller stores
router.get('/stores', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.listStores(req.query as never)); } catch (e) { next(e); }
});

router.get('/:id/store/categories', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.getStoreCategories(req.params.id)); } catch (e) { next(e); }
});

router.get('/:id/store/products', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.getStoreProducts(req.params.id, req.query as never)); } catch (e) { next(e); }
});

router.get('/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.getSeller(req.params.id)); } catch (e) { next(e); }
});

router.patch('/:id/status', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.updateSellerStatus(req.params.id, req.body.status)); } catch (e) { next(e); }
});

router.delete('/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.deleteSeller(req.params.id)); } catch (e) { next(e); }
});

router.post('/:id/approve', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.reviewOnboarding(req.params.id, 'APPROVE', req.body.comment, req.user!.sub, req.body.shopType)); } catch (e) { next(e); }
});

router.post('/:id/reject', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.reviewOnboarding(req.params.id, 'REJECT', req.body.comment, req.user!.sub, req.body.shopType)); } catch (e) { next(e); }
});

router.post('/:id/request-changes', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.reviewOnboarding(req.params.id, 'CHANGES_REQUESTED', req.body.comment, req.user!.sub, req.body.shopType)); } catch (e) { next(e); }
});

// Seller-facing: platform JWT from user-service
router.post('/register', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    // Trusted phone for UID-rotation recovery — never req.body.
    const verifiedPhone = token ? (await fetchVerifiedProfile(token))?.phone : undefined;

    const seller = await SellerService.registerSeller({
      userId: req.user!.sub,
      fullName: req.body.fullName || req.user!.name || 'Seller',
      mobileNumber: req.body.mobileNumber,
      email: req.body.email || req.user!.email,
      verifiedPhone,
    });
    return success(res, seller, 201);
  } catch (e) { next(e); }
});

router.get('/onboarding/me', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await SellerService.getSeller(req.user!.sellerId!);
    return success(res, data);
  } catch (e) { next(e); }
});

router.put('/onboarding/me', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const onboarding = await SellerService.saveOnboarding(req.user!.sellerId!, req.body, req.body.submit);
    return success(res, onboarding);
  } catch (e) { next(e); }
});

router.post('/onboarding/verify-pan', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { pan } = req.body as { pan?: string };

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📱 [SELLER APP → SELLER BACKEND] Received PAN Verification Request');
    console.log(`📍 Seller ID: ${req.user?.sellerId || 'N/A'}`);
    console.log(`📍 PAN Number: ${pan ? (pan.trim().substring(0, 2) + 'XXX' + pan.trim().slice(-4)) : 'N/A'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!pan?.trim()) {
      return res.status(400).json({ success: false, error: 'PAN number is required' });
    }
    const token = req.headers.authorization || '';
    const result = await SellerService.verifySellerPAN(req.user!.sellerId!, pan.trim(), token);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ [SELLER BACKEND → SELLER APP] PAN Verification Response Sent');
    console.log(`📍 Status: ${result.panVerificationStatus}`);
    console.log(`📍 Name: ${result.panVerifiedName || 'N/A'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return success(res, result);
  } catch (e) { next(e); }
});

router.post('/onboarding/verify-gstin', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { gstin, businessName } = req.body as { gstin?: string; businessName?: string };
    if (!gstin?.trim()) {
      return res.status(400).json({ success: false, error: 'GSTIN number is required' });
    }
    const token = req.headers.authorization || '';
    const result = await SellerService.verifySellerGSTIN(req.user!.sellerId!, gstin.trim(), token, businessName?.trim());
    return success(res, result);
  } catch (e) { next(e); }
});

router.post('/documents/register', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { documentType, documentNumber } = req.body as { documentType?: string; documentNumber?: string };
    if (!documentType) {
      return res.status(400).json({ success: false, error: 'documentType is required' });
    }
    if (documentType !== 'FSSAI_CERTIFICATE') {
      return res.status(400).json({ success: false, error: 'Only FSSAI_CERTIFICATE is accepted' });
    }
    if (!documentNumber?.trim()) {
      return res.status(400).json({ success: false, error: 'documentNumber is required' });
    }

    const onboarding = await SellerOnboarding.findOne({ sellerId: req.user!.sellerId });
    if (!onboarding) {
      return res.status(400).json({ success: false, error: 'Save onboarding details before registering documents' });
    }
    if (onboarding.status === 'PENDING_APPROVAL' || onboarding.status === 'APPROVED') {
      return res.status(403).json({ success: false, error: 'Cannot modify documents while application is under review or approved' });
    }

    const existing = await SellerDocument.findOne({
      sellerId: req.user!.sellerId,
      documentType,
    });
    if (existing) {
      existing.documentNumber = documentNumber.trim();
      existing.fileName = `${documentType}-number`;
      await existing.save();
      return success(res, existing);
    }

    const doc = await SellerDocument.create({
      sellerId: req.user!.sellerId,
      onboardingId: onboarding._id,
      documentType,
      documentNumber: documentNumber.trim(),
      fileName: `${documentType}-number`,
      mimeType: 'text/plain',
      fileSize: 0,
    });
    return success(res, doc, 201);
  } catch (e) { next(e); }
});

router.post('/documents/upload', ...requireSeller, uploadDocument.single('document'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No document provided' });
    const documentType = req.body.documentType;
    if (documentType !== 'FSSAI_CERTIFICATE' && documentType !== 'SHOP_IMAGE') {
      return res.status(400).json({ success: false, error: 'Only FSSAI_CERTIFICATE and SHOP_IMAGE are accepted' });
    }
    const onboarding = await SellerOnboarding.findOne({ sellerId: req.user!.sellerId });
    if (!onboarding) {
      return res.status(400).json({ success: false, error: 'Save onboarding details before uploading documents' });
    }
    if (onboarding.status === 'PENDING_APPROVAL' || onboarding.status === 'APPROVED') {
      return res.status(403).json({ success: false, error: 'Cannot modify documents while application is under review or approved' });
    }

    const result = await uploadFile(req.file, documentType === 'SHOP_IMAGE' ? 'shop-images' : 'seller-documents');
    if (documentType === 'SHOP_IMAGE') {
      onboarding.shopImageUrl = result.url;
      await onboarding.save();
    }
    const existing = await SellerDocument.findOne({
      sellerId: req.user!.sellerId,
      documentType,
    });
    if (existing) {
      existing.onboardingId = onboarding._id;
      existing.documentNumber = req.body.documentNumber;
      existing.fileUrl = result.url;
      existing.fileName = result.fileName;
      existing.mimeType = result.mimeType;
      existing.fileSize = result.fileSize;
      await existing.save();
      return success(res, existing);
    }

    const doc = await SellerDocument.create({
      sellerId: req.user!.sellerId,
      onboardingId: onboarding._id,
      documentType,
      documentNumber: req.body.documentNumber,
      fileUrl: result.url,
      fileName: result.fileName,
      mimeType: result.mimeType,
      fileSize: result.fileSize,
    });
    return success(res, doc, 201);
  } catch (e) { next(e); }
});

export default router;

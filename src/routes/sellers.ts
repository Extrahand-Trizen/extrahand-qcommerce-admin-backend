import { Router, Response, NextFunction } from 'express';
import { SellerService } from '../services/SellerService';
import { AdminSellerFinancialService } from '../services/AdminSellerFinancialService';
import { AdminPromotionService } from '../services/AdminPromotionService';
import { AuthRequest, requireAdmin, requireSeller, requireSellerAdmin, authenticate, authenticateSeller } from '../middleware/auth';
import { success } from '../utils/response';
import { fetchVerifiedProfile } from '../utils/userProfile';
import { uploadDocument } from '../middleware/upload';
import { uploadFile } from '../utils/storage';
import SellerDocument from '../models/SellerDocument';
import SellerOnboarding from '../models/SellerOnboarding';
import { DOCUMENT_TYPES } from '../types';

const router = Router();
// Admin-facing seller management endpoints — only SUPER_ADMIN and SELLER_OPERATIONS_ADMIN.
const admin = requireSellerAdmin;

// Admin: list all seller promotions (coupons and instant price drops)
router.get('/admin/promotions', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await AdminPromotionService.listPromotions(req.query as never));
  } catch (e) { next(e); }
});

// Admin: get seller promotion detail by ID
router.get('/admin/promotions/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await AdminPromotionService.getPromotionById(req.params.id));
  } catch (e) { next(e); }
});

// Admin: list all seller payouts across platform
router.get('/admin/payouts', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await AdminSellerFinancialService.listPayouts(req.query as never));
  } catch (e) { next(e); }
});

// Admin: view specific payout details
router.get('/admin/payouts/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await AdminSellerFinancialService.getPayoutById(req.params.id));
  } catch (e) { next(e); }
});

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

router.get('/:id([0-9a-fA-F]{24})/financial-summary', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await AdminSellerFinancialService.getSellerFinancialSummary(req.params.id)); } catch (e) { next(e); }
});

router.get('/:id([0-9a-fA-F]{24})/payouts', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await AdminSellerFinancialService.listPayouts({ sellerId: req.params.id, ...req.query as any })); } catch (e) { next(e); }
});

router.get('/:id([0-9a-fA-F]{24})/settlements', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await AdminSellerFinancialService.getSellerSettlements(req.params.id, Number(req.query.page || 1), Number(req.query.limit || 20))); } catch (e) { next(e); }
});

router.get('/:id([0-9a-fA-F]{24})/store/categories', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.getStoreCategories(req.params.id)); } catch (e) { next(e); }
});

router.get('/:id([0-9a-fA-F]{24})/store/products', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.getStoreProducts(req.params.id, req.query as never)); } catch (e) { next(e); }
});

router.get('/:id([0-9a-fA-F]{24})', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.getSeller(req.params.id)); } catch (e) { next(e); }
});

router.patch('/:id([0-9a-fA-F]{24})/status', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.updateSellerStatus(req.params.id, req.body.status)); } catch (e) { next(e); }
});

router.delete('/:id([0-9a-fA-F]{24})', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.deleteSeller(req.params.id)); } catch (e) { next(e); }
});

router.post('/:id([0-9a-fA-F]{24})/approve', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.reviewOnboarding(req.params.id, 'APPROVE', req.body.comment, req.user!.sub, req.body.shopType)); } catch (e) { next(e); }
});

router.post('/:id([0-9a-fA-F]{24})/reject', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.reviewOnboarding(req.params.id, 'REJECT', req.body.comment, req.user!.sub, req.body.shopType)); } catch (e) { next(e); }
});

router.post('/:id([0-9a-fA-F]{24})/request-changes', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.reviewOnboarding(req.params.id, 'CHANGES_REQUESTED', req.body.comment, req.user!.sub, req.body.shopType)); } catch (e) { next(e); }
});

// Seller-facing: platform JWT from user-service
router.post('/register', authenticateSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
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

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📱 [SELLER APP → SELLER BACKEND] Received GSTIN Verification Request');
    console.log(`📍 Seller ID: ${req.user?.sellerId || 'N/A'}`);
    console.log(`📍 GSTIN: ${gstin ? (gstin.trim().substring(0, 2) + 'XXXXXXXXX' + gstin.trim().slice(-4)) : 'N/A'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!gstin?.trim()) {
      return res.status(400).json({ success: false, error: 'GSTIN number is required' });
    }
    const token = req.headers.authorization || '';
    const result = await SellerService.verifySellerGSTIN(req.user!.sellerId!, gstin.trim(), token, businessName?.trim());

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ [SELLER BACKEND → SELLER APP] GSTIN Verification Response Sent');
    console.log(`📍 Status: ${result.gstinVerificationStatus}`);
    console.log(`📍 Legal Name: ${result.gstinVerifiedLegalName || 'N/A'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return success(res, result);
  } catch (e) { next(e); }
});

router.post('/onboarding/verify-aadhaar', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      aadhaarNumber,
      aadhaarFrontImage,
      aadhaarFrontUri,
      frontImage,
      aadhaarBackImage,
      aadhaarBackUri,
      backImage,
      aadhaarFrontCrop,
      aadhaarBackCrop,
      frontCrop,
      backCrop,
    } = req.body as {
      aadhaarNumber?: string;
      aadhaarFrontImage?: string;
      aadhaarFrontUri?: string;
      frontImage?: string;
      aadhaarBackImage?: string;
      aadhaarBackUri?: string;
      backImage?: string;
      aadhaarFrontCrop?: Record<string, unknown>;
      aadhaarBackCrop?: Record<string, unknown>;
      frontCrop?: Record<string, unknown>;
      backCrop?: Record<string, unknown>;
    };

    const targetFront = (aadhaarFrontImage || aadhaarFrontUri || frontImage || '').trim();
    const targetBack = (aadhaarBackImage || aadhaarBackUri || backImage || '').trim();
    const targetFrontCrop = aadhaarFrontCrop || frontCrop;
    const targetBackCrop = aadhaarBackCrop || backCrop;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📱 [SELLER APP → SELLER BACKEND] Received Aadhaar Verification Request');
    console.log(`📍 Seller ID: ${req.user?.sellerId || 'N/A'}`);
    console.log(`📍 Aadhaar: ${aadhaarNumber ? ('XXXX-XXXX-' + aadhaarNumber.replace(/[\s-]/g, '').slice(-4)) : 'N/A'}`);
    console.log(`📍 Front Image: ${targetFront ? 'Uploaded' : 'Missing'}`);
    console.log(`📍 Back Image: ${targetBack ? 'Uploaded' : 'Missing'}`);
    console.log(`📍 Crop Data: ${targetFrontCrop ? 'Provided' : 'Default'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!aadhaarNumber?.trim()) {
      return res.status(400).json({ success: false, error: 'Aadhaar number is required' });
    }
    if (!targetFront) {
      return res.status(400).json({ success: false, error: 'Aadhaar front-side image is required' });
    }
    if (!targetBack) {
      return res.status(400).json({ success: false, error: 'Aadhaar back-side image is required' });
    }

    const token = req.headers.authorization || '';
    const result = await SellerService.verifySellerAadhaar(
      req.user!.sellerId!,
      aadhaarNumber.trim(),
      token,
      targetFront,
      targetBack,
      targetFrontCrop,
      targetBackCrop,
    );

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ [SELLER BACKEND → SELLER APP] Aadhaar Verification Response Sent');
    console.log(`📍 Status: ${result.aadhaarVerificationStatus}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return success(res, result);
  } catch (e) { next(e); }
});

router.post('/onboarding/verify-aadhaar-otp', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { refId, otp, aadhaarNumber } = req.body as { refId?: string; otp?: string; aadhaarNumber?: string };
    if (!otp?.trim()) {
      return res.status(400).json({ success: false, error: 'OTP is required' });
    }

    const token = req.headers.authorization || '';
    const result = await SellerService.verifySellerAadhaarOTP(
      req.user!.sellerId!,
      token,
      refId ? refId.trim() : '',
      otp.trim(),
      aadhaarNumber?.trim()
    );

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ [SELLER BACKEND → SELLER APP] Aadhaar OTP Verification Response Sent');
    console.log(`📍 Status: ${result.aadhaarVerificationStatus}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return success(res, result);
  } catch (e) { next(e); }
});

router.post('/onboarding/verify-bank', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { accountNumber, ifscCode, ifsc, accountHolderName } = req.body as {
      accountNumber?: string;
      ifscCode?: string;
      ifsc?: string;
      accountHolderName?: string;
    };

    const targetAccount = (accountNumber || '').trim();
    const targetIfsc = (ifscCode || ifsc || '').trim().toUpperCase();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📱 [SELLER APP → SELLER BACKEND] Received Bank Verification Request');
    console.log(`📍 Seller ID: ${req.user?.sellerId || 'N/A'}`);
    console.log(`📍 Account: ${targetAccount ? ('XXXX' + targetAccount.slice(-4)) : 'N/A'}`);
    console.log(`📍 IFSC: ${targetIfsc || 'N/A'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!targetAccount) {
      return res.status(400).json({ success: false, error: 'Bank account number is required' });
    }
    if (!targetIfsc) {
      return res.status(400).json({ success: false, error: 'IFSC code is required' });
    }

    const token = req.headers.authorization || '';
    const result = await SellerService.verifySellerBankAccount(
      req.user!.sellerId!,
      targetAccount,
      targetIfsc,
      accountHolderName?.trim(),
      token
    );

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ [SELLER BACKEND → SELLER APP] Bank Verification Response Sent');
    console.log(`📍 Status: ${result.verificationStatus}`);
    console.log(`📍 Holder: ${result.accountHolderName}`);
    console.log(`📍 Bank: ${result.bankName}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return success(res, result);
  } catch (e) { next(e); }
});

router.post('/documents/register', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { documentType, documentNumber } = req.body as { documentType?: string; documentNumber?: string };
    if (!documentType) {
      return res.status(400).json({ success: false, error: 'documentType is required' });
    }
    if (!DOCUMENT_TYPES.includes(documentType as (typeof DOCUMENT_TYPES)[number])) {
      return res.status(400).json({ success: false, error: `Unsupported document type: ${documentType}` });
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
    if (!DOCUMENT_TYPES.includes(documentType as (typeof DOCUMENT_TYPES)[number])) {
      return res.status(400).json({ success: false, error: `Unsupported document type: ${documentType}` });
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
    } else if (['BANK_PASSBOOK', 'PASSBOOK', 'BANK_DOCUMENT', 'CANCELLED_CHEQUE', 'CHEQUE'].includes(String(documentType).toUpperCase())) {
      if (!onboarding.bankAccount) {
        onboarding.bankAccount = {};
      }
      onboarding.bankAccount.passbookImageUrl = result.url;
      onboarding.bankAccount.passbookUri = result.url;
      onboarding.markModified('bankAccount');
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

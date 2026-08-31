import { Router, Response, NextFunction } from 'express';
import { SellerService } from '../services/SellerService';
import { AuthRequest, requireAdmin, requireSeller, authenticate } from '../middleware/auth';
import { success } from '../utils/response';
import { uploadDocument } from '../middleware/upload';
import { uploadFile } from '../utils/storage';
import SellerDocument from '../models/SellerDocument';
import SellerOnboarding from '../models/SellerOnboarding';

const router = Router();
const admin = requireAdmin;

// Admin: list all sellers
router.get('/', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.listSellers(req.query as never)); } catch (e) { next(e); }
});

// Admin: approvals (must be registered before /:id)
router.get('/approvals/list', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.listApprovals(req.query as never)); } catch (e) { next(e); }
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
  try { return success(res, await SellerService.reviewOnboarding(req.params.id, 'APPROVE', req.body.comment, req.user!.sub)); } catch (e) { next(e); }
});

router.post('/:id/reject', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.reviewOnboarding(req.params.id, 'REJECT', req.body.comment, req.user!.sub)); } catch (e) { next(e); }
});

router.post('/:id/request-changes', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await SellerService.reviewOnboarding(req.params.id, 'CHANGES_REQUESTED', req.body.comment, req.user!.sub)); } catch (e) { next(e); }
});

// Seller-facing: platform JWT from user-service
router.post('/register', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const seller = await SellerService.registerSeller({
      userId: req.user!.sub,
      fullName: req.body.fullName || req.user!.name || 'Seller',
      mobileNumber: req.body.mobileNumber,
      email: req.body.email || req.user!.email,
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

router.post('/documents/register', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { documentType, documentNumber } = req.body as { documentType?: string; documentNumber?: string };
    if (!documentType) {
      return res.status(400).json({ success: false, error: 'documentType is required' });
    }
    if (!documentNumber?.trim()) {
      return res.status(400).json({ success: false, error: 'documentNumber is required' });
    }

    const onboarding = await SellerOnboarding.findOne({ sellerId: req.user!.sellerId });
    if (!onboarding) {
      return res.status(400).json({ success: false, error: 'Save onboarding details before registering documents' });
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
    const result = await uploadFile(req.file, 'seller-documents');
    const onboarding = await SellerOnboarding.findOne({ sellerId: req.user!.sellerId });
    if (!onboarding) {
      return res.status(400).json({ success: false, error: 'Save onboarding details before uploading documents' });
    }
    const documentType = req.body.documentType;
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

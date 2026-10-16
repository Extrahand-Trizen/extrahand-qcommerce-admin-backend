import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { Router, Response, NextFunction } from 'express';
import { SellerService } from '../services/SellerService';
import { AdminSellerFinancialService } from '../services/AdminSellerFinancialService';
import { AdminPromotionService } from '../services/AdminPromotionService';
import { AuthRequest, requireAdmin, requireSeller, requireSellerAdmin, authenticate, authenticateSeller } from '../middleware/auth';
import { success } from '../utils/response';
import { fetchVerifiedProfile } from '../utils/userProfile';
import { uploadDocument } from '../middleware/upload';
import { uploadFile, getPresignedReadUrl, getMinioClient, parseStoredAssetPath, parseMinioObjectUrl, LOCAL_UPLOAD_DIR } from '../utils/storage';
import { resolveSecureDocumentUrl, resolvePublicAssetUrl } from '../utils/media';
import { verifyToken } from '../utils/jwt';
import { verifyDocumentAccessToken } from '../utils/documentAccess';
import { env } from '../config/env';
import { resolveSellerByUidOrPhone } from '../services/SellerIdentityService';
import logger from '../config/logger';
import Seller from '../models/Seller';
import SellerDocument from '../models/SellerDocument';
import SellerOnboarding from '../models/SellerOnboarding';
import CustomerOrder from '../models/CustomerOrder';
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

// Admin: list all orders across platform with filters
router.get('/admin/orders', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || 'all').trim();
    const shop = String(req.query.shop || 'all').trim();
    const sellerId = String(req.query.sellerId || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || '20'), 10)));
    const filter: Record<string, any> = {};

    if (sellerId && mongoose.Types.ObjectId.isValid(sellerId)) {
      filter.sellerId = new mongoose.Types.ObjectId(sellerId);
    }
    if (search) {
      const regex = { $regex: search, $options: 'i' };
      filter.$or = [
        { orderNumber: regex },
        { shopName: regex },
        { 'address.name': regex },
        { 'address.phone': regex },
        { 'address.city': regex },
      ];
    }
    if (shop !== 'all' && !sellerId) {
      filter.shopName = { $regex: `^${shop}$`, $options: 'i' };
    }
    if (status === 'cancelled') {
      filter.$or = [{ status: { $in: ['CANCELLED', 'FAILED'] } }, { fulfillmentStatus: { $in: ['REJECTED', 'CANCELLED'] } }];
    } else if (status === 'completed') {
      filter.$or = [{ status: 'DELIVERED' }, { fulfillmentStatus: 'HANDED_OVER' }];
    } else if (status === 'open') {
      filter.status = { $in: ['PENDING_PAYMENT', 'PAID', 'CONFIRMED'] };
    } else if (status !== 'all') {
      filter.$or = [{ status: { $regex: status, $options: 'i' } }, { fulfillmentStatus: { $regex: status, $options: 'i' } }];
    }

    const sortDirection = String(req.query.sortOrder || 'desc') === 'asc' ? 1 : -1;
    const [total, rawOrders] = await Promise.all([
      CustomerOrder.countDocuments(filter),
      CustomerOrder.find(filter)
        .sort({ createdAt: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return success(res, {
      items: rawOrders.map((o: any) => ({
        id: String(o._id),
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        status: o.status,
        fulfillmentStatus: o.fulfillmentStatus,
        paymentStatus: o.paymentStatus,
        amount: typeof o.amount === 'number' ? o.amount : (o.amountPaise || 0) / 100,
        amountPaise: o.amountPaise || 0,
        itemsCount: o.items?.length || 0,
        items: o.items || [],
        address: o.address,
        shopName: o.shopName,
        sellerId: o.sellerId ? String(o.sellerId) : undefined,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      limit,
    });
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

router.get('/:id([0-9a-fA-F]{24})/orders', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, page, limit, search } = req.query as Record<string, string>;
    const sellerId = new mongoose.Types.ObjectId(req.params.id);
    const filter: Record<string, any> = { sellerId };
    if (status && status !== 'all') {
      const s = status.toUpperCase();
      if (s === 'CANCELLED') filter.$or = [{ status: { $in: ['CANCELLED', 'FAILED'] } }, { fulfillmentStatus: { $in: ['REJECTED', 'CANCELLED'] } }];
      else if (s === 'COMPLETED') filter.$or = [{ status: 'DELIVERED' }, { fulfillmentStatus: 'HANDED_OVER' }];
      else if (s === 'OPEN') filter.status = { $in: ['PENDING_PAYMENT', 'PAID', 'CONFIRMED'] };
      else filter.$or = [{ status: s }, { fulfillmentStatus: s }];
    }
    if (search?.trim()) {
      const regex = { $regex: search.trim(), $options: 'i' };
      filter.$or = [
        { orderNumber: regex },
        { 'address.name': regex },
        { 'address.phone': regex },
      ];
    }
    const pageNum = Math.max(1, parseInt(page || '1', 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit || '20', 10)));
    const [total, orders] = await Promise.all([
      CustomerOrder.countDocuments(filter),
      CustomerOrder.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
    ]);
    return success(res, {
      items: orders.map((o: any) => ({
        id: String(o._id),
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        status: o.status,
        fulfillmentStatus: o.fulfillmentStatus,
        paymentStatus: o.paymentStatus,
        amount: typeof o.amount === 'number' ? o.amount : (o.amountPaise || 0) / 100,
        amountPaise: o.amountPaise || 0,
        itemsCount: o.items?.length || 0,
        items: o.items || [],
        address: o.address,
        shopName: o.shopName,
      })),
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      limit: limitNum,
    });
  } catch (e) { next(e); }
});

// Secure document access: authorizes requester via signed token or JWT role & seller ownership
router.get('/:id([0-9a-fA-F]{24})/documents/:docIdOrType/file', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = req.params.id;
    const docIdOrType = req.params.docIdOrType;

    // SEC-V03: Set security and no-cache headers BEFORE any redirect, stream, or error response
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // 1. Authorization: check Query Token or Bearer JWT
    const { token, expires } = req.query as { token?: string; expires?: string };
    let authorized = false;
    let isAdmin = false;

    if (token) {
      if (verifyDocumentAccessToken(sellerId, docIdOrType, token, expires)) {
        authorized = true;
      }
    }

    if (!authorized) {
      const header = req.headers.authorization;
      const bearerToken = header?.startsWith('Bearer ') ? header.slice(7) : null;
      if (bearerToken) {
        try {
          const user = verifyToken(bearerToken);
          // Check role permissions:
          // Admin review personnel (SUPER_ADMIN, SELLER_OPERATIONS_ADMIN, OPERATIONS_ADMIN, ADMIN)
          const adminRoles = ['SUPER_ADMIN', 'SELLER_OPERATIONS_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'];
          if (adminRoles.includes(user.role) || (user as any).isSuperAdmin) {
            authorized = true;
            isAdmin = true;
          } else if (user.role === 'SELLER') {
            // Check seller ownership association
            let effectiveSellerId = user.sellerId;
            if (!effectiveSellerId) {
              const profile = await fetchVerifiedProfile(bearerToken);
              const resolution = await resolveSellerByUidOrPhone({
                userId: user.sub,
                verifiedPhone: profile?.phone,
              });
              if (resolution.ok) {
                effectiveSellerId = resolution.seller._id.toString();
              }
            }
            if (effectiveSellerId && effectiveSellerId === sellerId) {
              authorized = true;
            } else {
              return res.status(403).json({ success: false, error: 'Forbidden: Access denied to another seller documents' });
            }
          } else {
            return res.status(403).json({ success: false, error: 'Forbidden: Insufficient privileges' });
          }
        } catch {
          // Token verification failed
        }
      }
    }

    if (!authorized) {
      return res.status(401).json({ success: false, error: 'Authentication or valid access token required' });
    }

    // SEC-V06: Check seller account status before serving documents
    const seller = await Seller.findById(sellerId);
    if (!seller) {
      const onb = await SellerOnboarding.findOne({ sellerId });
      if (!onb) {
        return res.status(404).json({ success: false, error: 'Seller not found' });
      }
    } else if (!isAdmin) {
      // Non-admin access (seller JWT or query token): verify seller status is not suspended or deleted
      if (seller.status === 'SUSPENDED' || seller.status === 'DELETED') {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Seller account is suspended or deleted',
        });
      }
    }

    // 2. Fetch document record for this seller from database (never trust client-supplied path)
    let fileUrl: string | undefined;
    let mimeType: string = 'application/octet-stream';
    let fileName: string = 'document';

    if (mongoose.Types.ObjectId.isValid(docIdOrType)) {
      const doc = await SellerDocument.findOne({ _id: docIdOrType, sellerId });
      if (doc?.fileUrl) {
        fileUrl = doc.fileUrl;
        if (doc.mimeType) mimeType = doc.mimeType;
        if (doc.fileName) fileName = doc.fileName;
      }
    }

    if (!fileUrl) {
      // Search by documentType
      const normalizedDocType = docIdOrType.toUpperCase().replace(/[- ]/g, '_');
      const doc = await SellerDocument.findOne({
        sellerId,
        $or: [
          { documentType: normalizedDocType },
          { documentType: docIdOrType },
          { fileName: docIdOrType },
        ],
      });
      if (doc?.fileUrl) {
        fileUrl = doc.fileUrl;
        if (doc.mimeType) mimeType = doc.mimeType;
        if (doc.fileName) fileName = doc.fileName;
      }
    }

    if (!fileUrl) {
      // Fallback check on SellerOnboarding
      const onboarding = await SellerOnboarding.findOne({ sellerId });
      const lower = docIdOrType.toLowerCase();
      const oAny = onboarding as any;
      if ((lower.includes('bank') || lower.includes('passbook')) && (onboarding?.bankAccount?.passbookImageUrl || onboarding?.bankAccount?.passbookUri)) {
        fileUrl = onboarding.bankAccount.passbookImageUrl || onboarding.bankAccount.passbookUri;
        fileName = 'passbook';
      } else if (lower.includes('pan') && (oAny?.panCardUrl || oAny?.panCardUri || oAny?.panImageUrl || oAny?.panDocumentUri)) {
        fileUrl = oAny.panCardUrl || oAny.panCardUri || oAny.panImageUrl || oAny.panDocumentUri;
        fileName = 'pan-card';
      } else if (lower.includes('back') && (onboarding?.aadhaarBackImageUrl || oAny?.aadhaarBackImage || oAny?.aadhaarBackUri)) {
        fileUrl = onboarding?.aadhaarBackImageUrl || oAny?.aadhaarBackImage || oAny?.aadhaarBackUri;
        fileName = 'aadhaar-back';
      } else if ((lower.includes('aadhaar') || lower.includes('aadhar') || lower.includes('front') || lower.includes('kyc')) &&
                 (onboarding?.aadhaarFrontImageUrl || onboarding?.aadhaarDocumentUri)) {
        fileUrl = onboarding.aadhaarFrontImageUrl || onboarding.aadhaarDocumentUri;
        fileName = 'aadhaar-front';
      }
    }

    // Unwind circular proxy URLs if present in database
    if (fileUrl && fileUrl.includes('/documents/') && fileUrl.includes('/file')) {
      const onboarding = await SellerOnboarding.findOne({ sellerId });
      const oAny = onboarding as any;
      const lower = docIdOrType.toLowerCase();
      if ((lower.includes('aadhaar') || lower.includes('front')) &&
          onboarding?.aadhaarDocumentUri && !onboarding.aadhaarDocumentUri.includes('/documents/')) {
        fileUrl = onboarding.aadhaarDocumentUri;
      } else if (lower.includes('back') && oAny?.aadhaarBackImage && !oAny.aadhaarBackImage.includes('/documents/')) {
        fileUrl = oAny.aadhaarBackImage;
      } else if (lower.includes('pan') && oAny?.panDocumentUri && !oAny.panDocumentUri.includes('/documents/')) {
        fileUrl = oAny.panDocumentUri;
      }
    }

    if (!fileUrl) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    // 3A. Serve Base64 Data URI directly
    if (fileUrl.startsWith('data:')) {
      const match = fileUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const contentType = match[1];
        const buffer = Buffer.from(match[2], 'base64');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);
      }
    }

    // 3B. Serve MinIO object (stream directly through proxy, avoiding client CORS/network issues)
    const minioParsed = parseMinioObjectUrl(fileUrl);
    if (minioParsed && env.STORAGE_PROVIDER === 'minio') {
      try {
        const client = await getMinioClient();
        const stat = await client.statObject(minioParsed.bucket, minioParsed.objectName);
        if (stat.metaData?.['content-type']) {
          res.setHeader('Content-Type', stat.metaData['content-type']);
        } else if (minioParsed.objectName.endsWith('.jpg') || minioParsed.objectName.endsWith('.jpeg')) {
          res.setHeader('Content-Type', 'image/jpeg');
        } else if (minioParsed.objectName.endsWith('.png')) {
          res.setHeader('Content-Type', 'image/png');
        } else if (minioParsed.objectName.endsWith('.pdf')) {
          res.setHeader('Content-Type', 'application/pdf');
        }
        if (stat.size) {
          res.setHeader('Content-Length', stat.size);
        }
        const dataStream = await client.getObject(minioParsed.bucket, minioParsed.objectName);
        return dataStream.pipe(res);
      } catch (err: any) {
        logger.error('Failed to stream MinIO object, falling back to presigned URL redirect', {
          bucket: minioParsed.bucket,
          objectName: minioParsed.objectName,
          error: err?.message,
        });
        try {
          const presignedUrl = await getPresignedReadUrl(minioParsed.bucket, minioParsed.objectName, 86400);
          return res.redirect(302, presignedUrl);
        } catch {
          return res.status(404).json({ success: false, error: 'Document file not found in storage' });
        }
      }
    }

    // 3C. Local storage path resolution & traversal guard
    const parsedPath = parseStoredAssetPath(fileUrl);
    if (!parsedPath || !parsedPath.relPath) {
      return res.status(404).json({ success: false, error: 'Document file path cannot be resolved' });
    }
    const resolvedPath = path.resolve(LOCAL_UPLOAD_DIR, parsedPath.relPath);
    const resolvedUploadDir = path.resolve(LOCAL_UPLOAD_DIR);

    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      logger.error('Path traversal attempt detected in document serving endpoint', {
        sellerId,
        docIdOrType,
        fileUrl,
        resolvedPath,
      });
      return res.status(400).json({ success: false, error: 'Invalid document file path' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, error: 'Document file not found on disk' });
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
    } else if (ext === '.jpg' || ext === '.jpeg') {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (ext === '.png') {
      res.setHeader('Content-Type', 'image/png');
    } else if (ext === '.webp') {
      res.setHeader('Content-Type', 'image/webp');
    } else if (mimeType && mimeType !== 'application/octet-stream') {
      res.setHeader('Content-Type', mimeType);
    }

    return res.sendFile(resolvedPath);
  } catch (e) {
    next(e);
  }
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

    if (!targetFront) {
      return res.status(400).json({ success: false, error: 'Aadhaar front-side image is required' });
    }
    if (!targetBack) {
      return res.status(400).json({ success: false, error: 'Aadhaar back-side image is required' });
    }

    const token = req.headers.authorization || '';
    const result = await SellerService.verifySellerAadhaar(
      req.user!.sellerId!,
      aadhaarNumber?.trim() || undefined,
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

router.post('/onboarding/resend-aadhaar-otp', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization || '';
    const result = await SellerService.resendSellerAadhaarOTP(
      req.user!.sellerId!,
      token
    );

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ [SELLER BACKEND → SELLER APP] Aadhaar OTP Resend Response Sent');
    console.log(`📍 RefId: ${result.refId}`);
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

    const isBankDoc = ['BANK_PASSBOOK', 'PASSBOOK', 'BANK_DOCUMENT', 'CANCELLED_CHEQUE', 'CHEQUE'].includes(String(documentType).toUpperCase());
    const uploadSubdir = documentType === 'SHOP_IMAGE' ? 'shop-images' : isBankDoc ? 'bank-documents' : 'seller-documents';
    const result = await uploadFile(req.file, uploadSubdir);
    if (documentType === 'SHOP_IMAGE') {
      onboarding.shopImageUrl = result.url;
      await onboarding.save();
    } else if (isBankDoc) {
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

      const existingObj = existing.toObject ? existing.toObject() : { ...existing };
      if (documentType === 'SHOP_IMAGE') {
        existingObj.fileUrl = resolvePublicAssetUrl(result.url);
        (existingObj as any).downloadUrl = existingObj.fileUrl;
      } else {
        const secureUrl = await resolveSecureDocumentUrl(
          req.user!.sellerId!,
          String(existing._id),
          result.url,
        );
        existingObj.fileUrl = secureUrl;
        (existingObj as any).downloadUrl = secureUrl;
      }
      return success(res, existingObj);
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

    const docObj = doc.toObject ? doc.toObject() : { ...doc };
    if (documentType === 'SHOP_IMAGE') {
      docObj.fileUrl = resolvePublicAssetUrl(result.url);
      (docObj as any).downloadUrl = docObj.fileUrl;
    } else {
      const secureUrl = await resolveSecureDocumentUrl(
        req.user!.sellerId!,
        String(doc._id),
        result.url,
      );
      docObj.fileUrl = secureUrl;
      (docObj as any).downloadUrl = secureUrl;
    }
    return success(res, docObj, 201);
  } catch (e) { next(e); }
});

export default router;

import { Router, Response, NextFunction } from 'express';
import { AuthRequest, requireSeller } from '../middleware/auth';
import { success, AppError } from '../utils/response';
import { SellerDataExportService } from '../services/SellerDataExportService';
import fs from 'fs';

const router = Router();

/**
 * POST /api/v1/seller/business-data-export/start
 * Initiate comprehensive seller business data export.
 */
router.post(
  '/business-data-export/start',
  ...requireSeller,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const job = await SellerDataExportService.startExport(sellerId);
      return success(res, { job });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET /api/v1/seller/business-data-export/status
 * Poll current status of business records export.
 */
router.get(
  '/business-data-export/status',
  ...requireSeller,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const job = SellerDataExportService.getStatus(sellerId);
      return success(res, { job });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET /api/v1/seller/business-data-export/download/:token
 * Download generated ZIP archive using secure, time-limited token.
 * Open to browser and native download managers without requiring Authorization header.
 */
router.get(
  '/business-data-export/download/:token',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.params.token;
      if (!token) {
        throw new AppError('Download token is required', 400);
      }

      const fileInfo = SellerDataExportService.getFileByToken(token);
      if (!fileInfo || !fs.existsSync(fileInfo.filePath)) {
        return res.status(404).json({
          success: false,
          error: 'Export file has expired or was not found. Please request a new export from the Seller App.',
        });
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.fileName}"`);
      return res.download(fileInfo.filePath, fileInfo.fileName);
    } catch (e) {
      next(e);
    }
  },
);

export default router;


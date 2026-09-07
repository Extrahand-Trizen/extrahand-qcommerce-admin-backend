import { Router, Response, NextFunction } from 'express';
import { MasterProductService } from '../services/MasterProductService';
import { AuthRequest, requireCatalogueAdmin } from '../middleware/auth';
import { success } from '../utils/response';
import { uploadImage } from '../middleware/upload';
import { uploadFile } from '../utils/storage';

const router = Router();
const admin = requireCatalogueAdmin;

router.get('/master-products/meta/brands', ...admin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await MasterProductService.listBrands()); } catch (e) { next(e); }
});

router.get('/master-products', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await MasterProductService.list(req.query as never)); } catch (e) { next(e); }
});

router.get('/master-products/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await MasterProductService.getById(req.params.id)); } catch (e) { next(e); }
});

router.post('/master-products', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await MasterProductService.create(req.body, req.user!.sub), 201); } catch (e) { next(e); }
});

router.patch('/master-products/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await MasterProductService.update(req.params.id, req.body, req.user!.sub)); } catch (e) { next(e); }
});

router.delete('/master-products/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await MasterProductService.delete(req.params.id)); } catch (e) { next(e); }
});

router.post('/master-products/upload-image', ...admin, uploadImage.single('image'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image provided' });
    const result = await uploadFile(req.file, 'products');
    return success(res, result, 201);
  } catch (e) { next(e); }
});

// Alias for products list
router.get('/products', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await MasterProductService.list(req.query as never)); } catch (e) { next(e); }
});

export default router;

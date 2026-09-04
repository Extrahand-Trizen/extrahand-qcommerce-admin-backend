import { Router, Response, NextFunction } from 'express';
import { CatalogueService } from '../services/CatalogueService';
import { AuthRequest, requireCatalogueAdmin } from '../middleware/auth';
import { success } from '../utils/response';
import { uploadImage } from '../middleware/upload';
import { uploadFile } from '../utils/storage';

const router = Router();
const admin = requireCatalogueAdmin;

async function uploadCatalogueImage(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  subdir: string,
) {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image provided' });
    return success(res, await uploadFile(req.file, subdir), 201);
  } catch (e) { next(e); }
}

router.post('/categories/upload-image', ...admin, uploadImage.single('image'), (req: AuthRequest, res: Response, next: NextFunction) =>
  uploadCatalogueImage(req, res, next, 'categories'),
);
router.post('/subcategories/upload-image', ...admin, uploadImage.single('image'), (req: AuthRequest, res: Response, next: NextFunction) =>
  uploadCatalogueImage(req, res, next, 'subcategories'),
);

// Categories
router.get('/categories', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.listCategories(req.query as never)); } catch (e) { next(e); }
});
router.get('/categories/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.getCategory(req.params.id)); } catch (e) { next(e); }
});
router.post('/categories', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.createCategory(req.body, req.user!.sub), 201); } catch (e) { next(e); }
});
router.patch('/categories/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.updateCategory(req.params.id, req.body, req.user!.sub)); } catch (e) { next(e); }
});
router.delete('/categories/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.deleteCategory(req.params.id)); } catch (e) { next(e); }
});

// Subcategories
router.get('/subcategories', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.listSubcategories(req.query as never)); } catch (e) { next(e); }
});
router.get('/subcategories/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.getSubcategory(req.params.id)); } catch (e) { next(e); }
});
router.post('/subcategories', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.createSubcategory(req.body, req.user!.sub), 201); } catch (e) { next(e); }
});
router.patch('/subcategories/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.updateSubcategory(req.params.id, req.body, req.user!.sub)); } catch (e) { next(e); }
});
router.delete('/subcategories/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.deleteSubcategory(req.params.id)); } catch (e) { next(e); }
});

// Product Types
router.get('/product-types', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.listProductTypes(req.query as never)); } catch (e) { next(e); }
});
router.get('/product-types/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.getProductType(req.params.id)); } catch (e) { next(e); }
});
router.post('/product-types', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.createProductType(req.body, req.user!.sub), 201); } catch (e) { next(e); }
});
router.patch('/product-types/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.updateProductType(req.params.id, req.body, req.user!.sub)); } catch (e) { next(e); }
});
router.delete('/product-types/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.deleteProductType(req.params.id)); } catch (e) { next(e); }
});

// Attributes
router.get('/attributes', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.listAttributes(req.query as never)); } catch (e) { next(e); }
});
router.get('/attributes/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.getAttribute(req.params.id)); } catch (e) { next(e); }
});
router.post('/attributes', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.createAttribute(req.body, req.user!.sub), 201); } catch (e) { next(e); }
});
router.patch('/attributes/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.updateAttribute(req.params.id, req.body, req.user!.sub)); } catch (e) { next(e); }
});
router.delete('/attributes/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.deleteAttribute(req.params.id)); } catch (e) { next(e); }
});

// Product Type Attributes
router.get('/product-type-attributes/:productTypeId', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.listProductTypeAttributes(req.params.productTypeId)); } catch (e) { next(e); }
});
router.put('/product-type-attributes/:productTypeId', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await CatalogueService.setProductTypeAttributes(req.params.productTypeId, req.body.mappings || [])); } catch (e) { next(e); }
});

export default router;

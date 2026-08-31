import { Router, Response, NextFunction } from 'express';
import { DashboardService } from '../services/DashboardService';
import { AuthRequest, requireAdmin } from '../middleware/auth';
import { success } from '../utils/response';

const router = Router();

router.get('/', ...requireAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [stats, activity] = await Promise.all([
      DashboardService.getStats(),
      DashboardService.getRecentActivity(),
    ]);
    return success(res, { stats, activity });
  } catch (e) { next(e); }
});

export default router;

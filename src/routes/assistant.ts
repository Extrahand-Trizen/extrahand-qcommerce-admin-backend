import { Router, Response, NextFunction } from 'express';
import { AuthRequest, authenticateCustomer } from '../middleware/auth';
import { success, AppError } from '../utils/response';
import { QcAssistantService } from '../services/assistant/QcAssistantService';
import { assistantMessageRateLimit } from '../middleware/assistantRateLimit';

const router = Router();

router.post(
  '/assistant/conversations',
  authenticateCustomer,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orderId =
        typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : undefined;
      return success(
        res,
        await QcAssistantService.createOrResumeConversation(req.user!.sub, orderId),
        201,
      );
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/assistant/conversations/:conversationId',
  authenticateCustomer,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      return success(
        res,
        await QcAssistantService.getConversation(req.user!.sub, req.params.conversationId),
      );
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/assistant/conversations/:conversationId/messages',
  authenticateCustomer,
  assistantMessageRateLimit,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const text =
        typeof req.body?.text === 'string'
          ? req.body.text
          : typeof req.body?.message === 'string'
            ? req.body.message
            : '';
      if (!String(text).trim()) {
        throw new AppError('Message is required', 400);
      }
      return success(
        res,
        await QcAssistantService.postMessage(
          req.user!.sub,
          req.params.conversationId,
          text,
        ),
      );
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/assistant/conversations/:conversationId/end',
  authenticateCustomer,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      return success(
        res,
        await QcAssistantService.endConversation(req.user!.sub, req.params.conversationId),
      );
    } catch (e) {
      next(e);
    }
  },
);

export default router;

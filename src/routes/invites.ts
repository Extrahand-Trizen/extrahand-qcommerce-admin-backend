import { Router } from 'express';
import { AdminInviteController } from '../controllers/AdminInviteController';

const router = Router();

// Public endpoint - no authentication required for accepting invitations
router.post('/:inviteId/accept', AdminInviteController.acceptInvite);

export default router;

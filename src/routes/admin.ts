import { Router } from 'express';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { AdminUserController } from '../controllers/AdminUserController';
import { AdminInviteController } from '../controllers/AdminInviteController';

const router = Router();

// All admin management routes require authentication and SUPER_ADMIN role
router.use(authenticate, requireSuperAdmin);

// Admin User Management
router.get('/users', AdminUserController.listUsers);
router.get('/users/:id', AdminUserController.getUser);
router.patch('/users/:id', AdminUserController.updateUser);
router.put('/users/:id', AdminUserController.updateUser);
router.delete('/users/:id', AdminUserController.deleteUser);

// Admin Invite Management
router.get('/invites', AdminInviteController.listInvites);
router.post('/invites', AdminInviteController.createInvite);
router.post('/invites/:inviteId/resend', AdminInviteController.resendInvite);
router.delete('/invites/:inviteId', AdminInviteController.cancelInvite);

export default router;

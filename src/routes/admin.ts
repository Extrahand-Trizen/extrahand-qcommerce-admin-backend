import { Router } from 'express';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { AdminUserController } from '../controllers/AdminUserController';
import { AdminInviteController } from '../controllers/AdminInviteController';
import { ShopRegistrationNotificationService } from '../services/ShopRegistrationNotificationService';

const router = Router();

// All admin management routes require authentication and SUPER_ADMIN role
router.use(authenticate, requireSuperAdmin);

// Admin User Management
router.get('/users', AdminUserController.listUsers);
router.post('/users', AdminUserController.createUser);
router.get('/users/:id', AdminUserController.getUser);
router.patch('/users/:id', AdminUserController.updateUser);
router.put('/users/:id', AdminUserController.updateUser);
router.delete('/users/:id', AdminUserController.deleteUser);

// Admin Invite Management
router.get('/invites', AdminInviteController.listInvites);
router.post('/invites', AdminInviteController.createInvite);
router.post('/invites/:inviteId/resend', AdminInviteController.resendInvite);
router.delete('/invites/:inviteId', AdminInviteController.cancelInvite);

// Shop Registration Email Notification Settings
router.get('/shop-registration-notification', async (_req, res, next) => {
  try {
    const config = await ShopRegistrationNotificationService.getConfig();
    return res.json({ success: true, data: config });
  } catch (e) {
    next(e);
  }
});

router.put('/shop-registration-notification', async (req, res, next) => {
  try {
    const { enabled, recipientEmails, exclusiveMobileNumbers, exclusions } = req.body;
    const adminIdentifier = (req as any).user?.name || (req as any).user?.email || 'admin';
    const config = await ShopRegistrationNotificationService.updateConfig(
      { enabled, recipientEmails, exclusiveMobileNumbers, exclusions },
      adminIdentifier
    );
    return res.json({ success: true, data: config });
  } catch (e) {
    next(e);
  }
});

router.get('/shop-registration-notification/lookup-phone', async (req, res, next) => {
  try {
    const phone = String(req.query.phone || '');
    const result = await ShopRegistrationNotificationService.lookupPhoneName(phone);
    return res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

router.post('/shop-registration-notification/test', async (_req, res, next) => {
  try {
    const result = await ShopRegistrationNotificationService.sendTestNotification();
    return res.json(result);
  } catch (e) {
    next(e);
  }
});

export default router;

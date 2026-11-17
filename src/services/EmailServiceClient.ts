import { env } from '../config/env';
import logger from '../config/logger';

export interface SellerAssignedEmailPayload {
  adminEmail: string;
  adminName: string;
  sellerId: string;
  sellerName: string;
  sellerPhone: string;
  sellerEmail?: string;
  shopName?: string;
  onboardingStatus?: string;
  assignmentType: 'ROUND_ROBIN' | 'MANUAL';
  assignedAt: Date;
}

export interface ShopRegistrationEmailPayload {
  recipients: string[];
  shopName: string;
  ownerName: string;
  mobileNumber: string;
  email?: string;
  category?: string;
  location?: string;
  registeredAt: Date;
  sellerId?: string;
}

/**
 * Best-effort HTTP client for extrahand-email-service.
 * Never throws so email outages never break seller registration or assignment flows.
 */
export class EmailServiceClient {
  static async sendSellerAssignedEmail(payload: SellerAssignedEmailPayload): Promise<boolean> {
    const baseUrl = env.EMAIL_SERVICE_URL?.trim().replace(/\/$/, '');
    if (!baseUrl) {
      logger.warn('EMAIL_SERVICE_URL not configured; skipping seller assignment email', {
        sellerId: payload.sellerId,
        adminEmail: payload.adminEmail,
      });
      return false;
    }

    const emailAuthToken = (env.EMAIL_SERVICE_AUTH_TOKEN || env.SERVICE_AUTH_TOKEN)?.trim();
    const frontendUrl = (env.FRONTEND_URL || 'http://localhost:3001').trim().replace(/\/$/, '');
    const dashboardUrl = `${frontendUrl}/sellers/users?search=${encodeURIComponent(payload.sellerPhone)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
      const response = await fetch(`${baseUrl}/api/v1/email/seller-assigned`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(emailAuthToken ? { 'X-Service-Auth': emailAuthToken } : {}),
          'X-Service-Name': 'qcommerce-admin-backend',
        },
        body: JSON.stringify({
          adminEmail: payload.adminEmail,
          adminName: payload.adminName,
          sellerId: payload.sellerId,
          sellerName: payload.sellerName,
          sellerPhone: payload.sellerPhone,
          sellerEmail: payload.sellerEmail,
          shopName: payload.shopName,
          onboardingStatus: payload.onboardingStatus,
          assignmentType: payload.assignmentType,
          assignedAt: payload.assignedAt.toISOString(),
          dashboardUrl,
          platformName: 'ExtraHand Q-Commerce Admin',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        logger.error('Email service returned non-2xx for seller-assigned', {
          status: response.status,
          sellerId: payload.sellerId,
          adminEmail: payload.adminEmail,
          body: errText.slice(0, 300),
        });
        return false;
      }

      logger.info('Queued seller assignment email via email-service', {
        sellerId: payload.sellerId,
        adminEmail: payload.adminEmail,
        assignmentType: payload.assignmentType,
      });
      return true;
    } catch (err: any) {
      logger.error('Failed to dispatch seller assignment email (non-fatal)', {
        sellerId: payload.sellerId,
        adminEmail: payload.adminEmail,
        error: err?.message || err,
      });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  static async sendShopRegistrationEmail(payload: ShopRegistrationEmailPayload): Promise<boolean> {
    const validRecipients = (payload.recipients || [])
      .map((r) => String(r || '').trim())
      .filter((r) => r.length > 0 && r.includes('@'));

    if (!validRecipients.length) {
      logger.warn('[ShopRegistrationEmail] No valid recipients configured; skipping email dispatch', {
        shopName: payload.shopName,
        sellerId: payload.sellerId,
      });
      return false;
    }

    const baseUrl = env.EMAIL_SERVICE_URL?.trim().replace(/\/$/, '');
    if (!baseUrl) {
      logger.warn('[ShopRegistrationEmail] EMAIL_SERVICE_URL not configured; skipping email notification', {
        shopName: payload.shopName,
        sellerId: payload.sellerId,
        recipients: validRecipients,
      });
      return false;
    }

    const emailAuthToken = (env.EMAIL_SERVICE_AUTH_TOKEN || env.SERVICE_AUTH_TOKEN)?.trim();
    const frontendUrl = (env.FRONTEND_URL || 'http://localhost:3001').trim().replace(/\/$/, '');
    const dashboardUrl = payload.sellerId
      ? `${frontendUrl}/sellers/stores/${payload.sellerId}`
      : `${frontendUrl}/sellers/stores?search=${encodeURIComponent(payload.mobileNumber)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(`${baseUrl}/api/v1/email/shop-registration`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(emailAuthToken ? { 'X-Service-Auth': emailAuthToken } : {}),
          'X-Service-Name': 'qcommerce-admin-backend',
        },
        body: JSON.stringify({
          recipients: validRecipients,
          shopName: payload.shopName,
          category: payload.category,
          location: payload.location,
          ownerName: payload.ownerName,
          mobileNumber: payload.mobileNumber,
          email: payload.email,
          registeredAt: payload.registeredAt.toISOString(),
          dashboardUrl,
          platformName: 'ExtraHand Q-Commerce Admin',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        logger.error('[ShopRegistrationEmail] Email service returned non-2xx response', {
          status: response.status,
          shopName: payload.shopName,
          sellerId: payload.sellerId,
          recipients: validRecipients,
          body: errText.slice(0, 300),
        });
        return false;
      }

      logger.info('[ShopRegistrationEmail] Notification email successfully queued via email-service', {
        shopName: payload.shopName,
        sellerId: payload.sellerId,
        recipientCount: validRecipients.length,
        recipients: validRecipients,
      });
      return true;
    } catch (err: any) {
      logger.error('[ShopRegistrationEmail] Failed to dispatch email notification (non-fatal)', {
        shopName: payload.shopName,
        sellerId: payload.sellerId,
        error: err?.message || err,
      });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}


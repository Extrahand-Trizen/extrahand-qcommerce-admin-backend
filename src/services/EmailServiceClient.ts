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
}


import mongoose from 'mongoose';
import ShopRegistrationNotificationConfig, {
  IShopRegistrationNotificationConfig,
} from '../models/ShopRegistrationNotificationConfig';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import AdminUser from '../models/AdminUser';
import CustomerOrder from '../models/CustomerOrder';
import { EmailServiceClient } from './EmailServiceClient';
import logger from '../config/logger';

export interface ShopRegistrationDetails {
  sellerId: string;
  shopName: string;
  ownerName: string;
  mobileNumber: string;
  email?: string;
  category?: string;
  location?: string;
  registeredAt?: Date;
}

/**
 * Normalizes any phone string (with country codes, spaces, dashes)
 * to its standard 10-digit format for reliable matching.
 */
export function normalizeMobileNumber(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export class ShopRegistrationNotificationService {
  /**
   * Fetch current configuration, creating default record if none exists.
   */
  static async getConfig(): Promise<IShopRegistrationNotificationConfig> {
    let config = await ShopRegistrationNotificationConfig.findOne().sort({ createdAt: -1 });
    if (!config) {
      config = await ShopRegistrationNotificationConfig.create({
        enabled: true,
        recipientEmails: [],
        exclusiveMobileNumbers: [],
        exclusions: [],
        updatedBy: 'system',
      });
    } else if ((!config.exclusions || config.exclusions.length === 0) && config.exclusiveMobileNumbers?.length) {
      config.exclusions = config.exclusiveMobileNumbers.map((num) => ({
        phone: num,
        name: 'Test / Partner Number',
      }));
    }
    return config;
  }

  /**
   * Update configuration (recipient emails, exclusive numbers, enabled state).
   */
  static async updateConfig(
    params: {
      enabled?: boolean;
      recipientEmails: string[];
      exclusiveMobileNumbers?: string[];
      exclusions?: Array<{ phone: string; name?: string }>;
    },
    updatedBy: string
  ): Promise<IShopRegistrationNotificationConfig> {
    // Sanitize and validate recipient emails
    const cleanEmails = Array.from(
      new Set(
        (params.recipientEmails || [])
          .map((e) => String(e || '').trim().toLowerCase())
          .filter((e) => e.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      )
    );

    // Sanitize exclusions
    let cleanExclusions: Array<{ phone: string; name: string }> = [];
    if (Array.isArray(params.exclusions) && params.exclusions.length > 0) {
      const seen = new Set<string>();
      for (const item of params.exclusions) {
        const phone = normalizeMobileNumber(item.phone);
        if (phone.length >= 10 && !seen.has(phone)) {
          seen.add(phone);
          cleanExclusions.push({
            phone,
            name: (item.name || 'Test / Partner Number').trim(),
          });
        }
      }
    } else if (Array.isArray(params.exclusiveMobileNumbers)) {
      const seen = new Set<string>();
      for (const num of params.exclusiveMobileNumbers) {
        const phone = normalizeMobileNumber(num);
        if (phone.length >= 10 && !seen.has(phone)) {
          seen.add(phone);
          cleanExclusions.push({
            phone,
            name: 'Test / Partner Number',
          });
        }
      }
    }

    const cleanNumbers = cleanExclusions.map((e) => e.phone);

    let config = await ShopRegistrationNotificationConfig.findOne().sort({ createdAt: -1 });
    if (!config) {
      config = new ShopRegistrationNotificationConfig({
        enabled: params.enabled !== undefined ? Boolean(params.enabled) : true,
        recipientEmails: cleanEmails,
        exclusiveMobileNumbers: cleanNumbers,
        exclusions: cleanExclusions,
        updatedBy,
      });
    } else {
      if (params.enabled !== undefined) {
        config.enabled = Boolean(params.enabled);
      }
      config.recipientEmails = cleanEmails;
      config.exclusiveMobileNumbers = cleanNumbers;
      config.exclusions = cleanExclusions;
      config.updatedBy = updatedBy;
    }

    await config.save();
    logger.info('[ShopRegistrationNotification] Settings updated successfully', {
      enabled: config.enabled,
      recipientCount: config.recipientEmails.length,
      exclusiveCount: config.exclusiveMobileNumbers.length,
      updatedBy,
    });

    return config;
  }

  /**
   * Core notification logic:
   * 1. Check feature toggle and recipient list.
   * 2. Normalize and check shop mobile number against exclusive numbers list.
   * 3. Prevent duplicate notifications for the same shop registration.
   * 4. Dispatch email notification asynchronously (never throwing / blocking).
   */
  static async handleShopRegistration(shop: ShopRegistrationDetails): Promise<void> {
    try {
      const config = await this.getConfig();

      if (!config.enabled) {
        logger.info('[ShopRegistrationNotification] Skipped: notification feature is disabled in settings', {
          sellerId: shop.sellerId,
          shopName: shop.shopName,
        });
        return;
      }

      if (!config.recipientEmails || config.recipientEmails.length === 0) {
        logger.info('[ShopRegistrationNotification] Skipped: no recipient email addresses configured', {
          sellerId: shop.sellerId,
          shopName: shop.shopName,
        });
        return;
      }

      // Check mobile number against exclusive list
      const normalizedShopPhone = normalizeMobileNumber(shop.mobileNumber);
      const normalizedExclusiveNumbers = config.exclusiveMobileNumbers.map(normalizeMobileNumber);

      const isExclusiveNumber =
        normalizedShopPhone.length >= 10 && normalizedExclusiveNumbers.includes(normalizedShopPhone);

      if (isExclusiveNumber) {
        logger.info(
          `[ShopRegistrationNotification] Skipped: registered mobile ${shop.mobileNumber} (normalized: ${normalizedShopPhone}) matches exclusive mobile number list.`,
          {
            sellerId: shop.sellerId,
            shopName: shop.shopName,
            mobileNumber: shop.mobileNumber,
            normalizedPhone: normalizedShopPhone,
          }
        );
        return;
      }

      // Check duplicate prevention
      if (shop.sellerId && mongoose.isValidObjectId(shop.sellerId)) {
        const onboarding = await SellerOnboarding.findOne({ sellerId: shop.sellerId }).select(
          'registrationNotificationSent'
        );
        if (onboarding?.registrationNotificationSent) {
          logger.info('[ShopRegistrationNotification] Skipped: notification already dispatched for this registration.', {
            sellerId: shop.sellerId,
            shopName: shop.shopName,
          });
          return;
        }
      }

      // Resolve category & location if not provided
      let resolvedCategory = shop.category;
      let resolvedLocation = shop.location;

      if ((!resolvedCategory || !resolvedLocation) && shop.sellerId && mongoose.isValidObjectId(shop.sellerId)) {
        try {
          const onboarding = await SellerOnboarding.findOne({ sellerId: shop.sellerId }).select(
            'category shopType formattedAddress address locality city state pincode'
          );
          if (onboarding) {
            if (!resolvedCategory) {
              resolvedCategory = onboarding.category || onboarding.shopType || undefined;
            }
            if (!resolvedLocation) {
              resolvedLocation =
                onboarding.formattedAddress ||
                [onboarding.address, onboarding.locality, onboarding.city, onboarding.state, onboarding.pincode]
                  .filter(Boolean)
                  .join(', ') ||
                undefined;
            }
          }
        } catch (e: any) {
          logger.warn('[ShopRegistrationNotification] Could not load onboarding details for category/location', {
            sellerId: shop.sellerId,
            error: e?.message,
          });
        }
      }

      // Dispatch email notification to all configured recipients
      logger.info('[ShopRegistrationNotification] Dispatching registration email notification', {
        shopName: shop.shopName,
        category: resolvedCategory,
        location: resolvedLocation,
        sellerId: shop.sellerId,
        recipients: config.recipientEmails,
      });

      const sent = await EmailServiceClient.sendShopRegistrationEmail({
        recipients: config.recipientEmails,
        shopName: shop.shopName || 'New Shop',
        ownerName: shop.ownerName || 'Store Owner',
        mobileNumber: shop.mobileNumber,
        email: shop.email,
        category: resolvedCategory,
        location: resolvedLocation,
        registeredAt: shop.registeredAt || new Date(),
        sellerId: shop.sellerId,
      });

      // Mark notification as sent to prevent duplicates
      if (shop.sellerId && mongoose.isValidObjectId(shop.sellerId)) {
        await SellerOnboarding.updateOne(
          { sellerId: shop.sellerId },
          {
            $set: {
              registrationNotificationSent: true,
              registrationNotificationSentAt: new Date(),
            },
          }
        ).catch((err) => {
          logger.warn('[ShopRegistrationNotification] Failed to record registrationNotificationSent flag', {
            sellerId: shop.sellerId,
            error: err?.message,
          });
        });
      }

      if (sent) {
        logger.info('[ShopRegistrationNotification] Email notification dispatched successfully', {
          shopName: shop.shopName,
          sellerId: shop.sellerId,
          recipientsCount: config.recipientEmails.length,
        });
      }
    } catch (err: any) {
      // Must NEVER fail or throw to ensure shop registration succeeds regardless of email outcomes
      logger.error('[ShopRegistrationNotification] Unexpected error in handleShopRegistration (non-fatal)', {
        sellerId: shop.sellerId,
        shopName: shop.shopName,
        error: err?.message || err,
      });
    }
  }

  /**
   * Send a test email to currently configured recipients for verification.
   */
  static async sendTestNotification(): Promise<{ success: boolean; message: string; recipients: string[] }> {
    const config = await this.getConfig();
    if (!config.recipientEmails.length) {
      return {
        success: false,
        message: 'No recipient email addresses configured. Please add at least one recipient email address.',
        recipients: [],
      };
    }

    const testShop: ShopRegistrationDetails = {
      sellerId: 'test-seller-id',
      shopName: 'Demo Store (Test Registration)',
      ownerName: 'Test Merchant Owner',
      mobileNumber: '9876543210',
      email: 'merchant.test@extrahand.in',
      category: 'Grocery & Daily Essentials',
      location: 'Madhapur, Hitech City, Hyderabad, Telangana - 500081',
      registeredAt: new Date(),
    };

    const sent = await EmailServiceClient.sendShopRegistrationEmail({
      recipients: config.recipientEmails,
      shopName: testShop.shopName,
      ownerName: testShop.ownerName,
      mobileNumber: testShop.mobileNumber,
      email: testShop.email,
      category: testShop.category,
      location: testShop.location,
      registeredAt: testShop.registeredAt!,
      sellerId: testShop.sellerId,
    });

    if (!sent) {
      return {
        success: false,
        message: 'Failed to dispatch test email. Please check email service configuration.',
        recipients: config.recipientEmails,
      };
    }

    return {
      success: true,
      message: `Test notification sent successfully to ${config.recipientEmails.length} recipient(s).`,
      recipients: config.recipientEmails,
    };
  }

  /**
   * Look up a phone number across Sellers, Onboardings, Admin Users, and Orders
   * to resolve the associated contact or customer name.
   */
  static async lookupPhoneName(rawPhone: string): Promise<{ phone: string; name: string | null }> {
    const cleanPhone = normalizeMobileNumber(rawPhone);
    if (!cleanPhone || cleanPhone.length < 10) {
      return { phone: cleanPhone, name: null };
    }

    const phoneVariantsList = [cleanPhone, `+91${cleanPhone}`, `91${cleanPhone}`];

    try {
      // 1. Check Seller
      const seller = await Seller.findOne({
        mobileNumber: { $in: phoneVariantsList },
      }).select('fullName email');
      if (seller?.fullName?.trim()) {
        return { phone: cleanPhone, name: seller.fullName.trim() };
      }

      // 2. Check SellerOnboarding
      const onboarding = await SellerOnboarding.findOne({
        $or: [
          { mobileNumber: { $in: phoneVariantsList } },
          { shopMobileNumber: { $in: phoneVariantsList } },
        ],
      }).select('fullName shopName');
      if (onboarding?.fullName?.trim()) {
        return { phone: cleanPhone, name: onboarding.fullName.trim() };
      }
      if (onboarding?.shopName?.trim()) {
        return { phone: cleanPhone, name: onboarding.shopName.trim() };
      }

      // 3. Check AdminUser
      const admin = await AdminUser.findOne({
        $or: [
          { phone: { $in: phoneVariantsList } },
          { mobileNumber: { $in: phoneVariantsList } },
        ],
      }).select('name');
      if (admin?.name?.trim()) {
        return { phone: cleanPhone, name: admin.name.trim() };
      }

      // 4. Check CustomerOrder (address.phone)
      const order = await CustomerOrder.findOne({
        $or: [
          { 'address.phone': { $in: phoneVariantsList } },
          { 'address.phone': { $regex: cleanPhone } },
        ],
      })
        .sort({ createdAt: -1 })
        .select('address.name');
      if (order?.address?.name?.trim()) {
        return { phone: cleanPhone, name: order.address.name.trim() };
      }
    } catch (err: any) {
      logger.warn('[ShopRegistrationNotification] Phone lookup error', {
        phone: cleanPhone,
        error: err?.message,
      });
    }

    return { phone: cleanPhone, name: null };
  }
}

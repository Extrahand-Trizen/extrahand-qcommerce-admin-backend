import { env } from '../config/env';
import logger from '../config/logger';
import { AppError } from '../utils/response';

export interface PanVerificationResult {
  success: boolean;
  name?: string;
  maskedPAN?: string;
  panNumber?: string;
  status?: string;
  verificationId?: string;
  message?: string;
}

export interface GstinVerificationResult {
  success: boolean;
  legalName?: string;
  tradeName?: string;
  gstin?: string;
  maskedGSTIN?: string;
  status?: string;
  taxpayerType?: string;
  registrationDate?: string;
  stateCode?: string;
  verificationId?: string;
  message?: string;
}

export interface BankVerificationResult {
  success: boolean;
  name?: string;
  bankName?: string;
  ifsc?: string;
  maskedBankAccount?: string;
  status?: string;
  verificationId?: string;
  referenceId?: string;
  message?: string;
}

export class VerificationServiceClient {
  private static getBaseUrl(): string {
    const raw = env.API_GATEWAY_URL || 'http://127.0.0.1:5000';
    return raw.replace(/\/+$/, '');
  }

  /**
   * Verify PAN card via API Gateway -> User Verification Service
   * @param userToken - Seller's Bearer JWT from Authorization header
   * @param panNumber - 10-character PAN string
   */
  public static async verifyPAN(userToken: string, panNumber: string): Promise<PanVerificationResult> {
    const url = `${this.getBaseUrl()}/api/v1/verification/pan/verify`;
    const cleanToken = userToken.startsWith('Bearer ') ? userToken.slice(7).trim() : userToken.trim();
    const serviceAuth = env.SERVICE_AUTH_TOKEN || env.USER_SERVICE_AUTH_TOKEN || 'X7fK9qP2Lm8VtR4zWc1YhN6DsB3aU5Jx';

    logger.info('🔀 [SELLER BACKEND → GATEWAY] Forwarding PAN verification request', { url, pan: panNumber.substring(0, 2) + 'XXX' + panNumber.slice(-4) });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanToken}`,
          'X-Service-Auth': serviceAuth,
        },
        body: JSON.stringify({ panNumber }),
      });

      const body = (await response.json()) as any;
      logger.info('✅ [GATEWAY → SELLER BACKEND] PAN verification response received', { status: response.status, success: body?.success });

      if (!response.ok || !body.success) {
        const errorMsg = body.error || body.message || 'PAN verification failed';
        logger.warn('PAN verification rejected by Verification Service', {
          status: response.status,
          error: errorMsg,
        });
        throw new AppError(errorMsg, response.status >= 400 && response.status < 500 ? response.status : 400);
      }

      const data = body.data || {};
      const verifiedData = data.verifiedData || {};

      if (data.status === 'failed' || data.status === 'FAILED' || data.status === 'invalid' || data.status === 'INVALID') {
        const errorMsg = data.message || body.message || 'PAN verification failed or invalid PAN';
        logger.warn('PAN status reported failed by Verification Service', {
          status: data.status,
          error: errorMsg,
        });
        throw new AppError(errorMsg, 400);
      }

      return {
        success: true,
        name: verifiedData.name || data.name,
        maskedPAN: data.maskedPAN,
        panNumber: verifiedData.panNumber || data.panNumber,
        status: data.status || 'verified',
        verificationId: data.verificationId,
        message: body.message,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error('VerificationServiceClient.verifyPAN network/unexpected error', { error: err.message });
      throw new AppError(err.message || 'Failed to communicate with Verification Gateway', 502);
    }
  }

  /**
   * Verify GSTIN via API Gateway -> User Verification Service
   * @param userToken - Seller's Bearer JWT from Authorization header
   * @param gstin - 15-character GSTIN string
   * @param businessName - Optional business name for match verification
   */
  public static async verifyGSTIN(
    userToken: string,
    gstin: string,
    businessName?: string
  ): Promise<GstinVerificationResult> {
    const url = `${this.getBaseUrl()}/api/v1/verification/gstin/verify`;
    const cleanToken = userToken.startsWith('Bearer ') ? userToken.slice(7).trim() : userToken.trim();
    const serviceAuth = env.SERVICE_AUTH_TOKEN || env.USER_SERVICE_AUTH_TOKEN || 'X7fK9qP2Lm8VtR4zWc1YhN6DsB3aU5Jx';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanToken}`,
          'X-Service-Auth': serviceAuth,
        },
        body: JSON.stringify({
          gstin,
          businessName,
          consent: {
            given: true,
            timestamp: new Date().toISOString(),
          },
        }),
      });

      const body = (await response.json()) as any;

      if (!response.ok || !body.success) {
        const errorMsg = body.error || body.message || 'GSTIN verification failed';
        logger.warn('GSTIN verification rejected by Verification Service', {
          status: response.status,
          error: errorMsg,
        });
        throw new AppError(errorMsg, response.status >= 400 && response.status < 500 ? response.status : 400);
      }

      const data = body.data || {};
      const verifiedData = data.verifiedData || {};

      if (data.status === 'failed' || data.status === 'FAILED' || data.status === 'invalid' || data.status === 'INVALID') {
        const errorMsg = data.message || body.message || 'GSTIN verification failed or invalid GSTIN';
        logger.warn('GSTIN status reported failed by Verification Service', {
          status: data.status,
          error: errorMsg,
        });
        throw new AppError(errorMsg, 400);
      }

      return {
        success: true,
        legalName: verifiedData.legalName || data.legalName,
        tradeName: verifiedData.tradeName || data.tradeName,
        gstin: verifiedData.gstin || data.gstin || gstin,
        maskedGSTIN: data.maskedGSTIN,
        status: verifiedData.status || data.status || 'Active',
        taxpayerType: verifiedData.taxpayerType || data.taxpayerType,
        registrationDate: verifiedData.registrationDate || data.registrationDate,
        stateCode: verifiedData.stateCode || data.stateCode,
        verificationId: data.verificationId,
        message: body.message,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error('VerificationServiceClient.verifyGSTIN network/unexpected error', { error: err.message });
      throw new AppError(err.message || 'Failed to communicate with Verification Gateway', 502);
    }
  }

  /**
   * Verify bank account via API Gateway -> User Verification Service -> Cashfree
   * @param userToken - Seller's Bearer JWT from Authorization header
   * @param accountNumber - Bank account number (9-18 digits)
   * @param ifsc - 11-character IFSC code
   * @param accountHolderName - Name of the account holder
   */
  public static async verifyBankAccount(
    userToken: string,
    accountNumber: string,
    ifsc: string,
    accountHolderName?: string
  ): Promise<BankVerificationResult> {
    const url = `${this.getBaseUrl()}/api/v1/verification/bank/verify`;
    const cleanToken = userToken.startsWith('Bearer ') ? userToken.slice(7).trim() : userToken.trim();
    const serviceAuth = env.SERVICE_AUTH_TOKEN || env.USER_SERVICE_AUTH_TOKEN || 'X7fK9qP2Lm8VtR4zWc1YhN6DsB3aU5Jx';

    logger.info('🔀 [SELLER BACKEND → GATEWAY] Forwarding Bank verification request', {
      url,
      accountMasked: 'XXXX' + accountNumber.slice(-4),
      ifsc,
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanToken}`,
          'X-Service-Auth': serviceAuth,
        },
        body: JSON.stringify({
          accountNumber,
          ifsc,
          accountHolderName,
          consent: {
            given: true,
            timestamp: new Date().toISOString(),
          },
        }),
      });

      const body = (await response.json()) as any;
      logger.info('✅ [GATEWAY → SELLER BACKEND] Bank verification response received', {
        status: response.status,
        success: body?.success,
      });

      if (!response.ok || !body.success) {
        const errorMsg = body.error || body.message || 'Bank account verification failed';
        logger.warn('Bank verification rejected by Verification Service', {
          status: response.status,
          error: errorMsg,
        });
        throw new AppError(errorMsg, response.status >= 400 && response.status < 500 ? response.status : 400);
      }

      const data = body.data || {};
      const verifiedData = data.verifiedData || {};

      if (data.status === 'failed' || data.status === 'FAILED' || data.status === 'invalid' || data.status === 'INVALID') {
        const errorMsg = data.message || body.message || 'Bank account verification failed or invalid account';
        logger.warn('Bank status reported failed by Verification Service', {
          status: data.status,
          error: errorMsg,
        });
        throw new AppError(errorMsg, 400);
      }

      return {
        success: true,
        name: verifiedData.accountHolderName || data.accountHolderName || accountHolderName,
        bankName: verifiedData.bankName || data.bankName,
        ifsc: verifiedData.ifsc || data.ifsc || ifsc,
        maskedBankAccount: data.maskedBankAccount || ('XXXX' + accountNumber.slice(-4)),
        status: data.status || 'verified',
        verificationId: data.verificationId,
        referenceId: data.referenceId || verifiedData.referenceId,
        message: body.message,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error('VerificationServiceClient.verifyBankAccount network/unexpected error', { error: err.message });
      throw new AppError(err.message || 'Failed to communicate with Verification Gateway', 502);
    }
  }
}


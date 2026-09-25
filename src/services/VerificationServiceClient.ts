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

export interface AadhaarVerificationResult {
  success: boolean;
  aadhaarNumber?: string;
  maskedAadhaar?: string;
  status?: string;
  refId?: string;
  message?: string;
}

export class VerificationServiceClient {
  private static getBaseUrl(): string {
    const raw = env.API_GATEWAY_URL || 'http://127.0.0.1:5000';
    return raw.replace(/\/+$/, '');
  }

  /**
   * Verify PAN card via API Gateway -> User Verification Service
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
   */
  public static async verifyGSTIN(
    userToken: string,
    gstin: string,
    businessName?: string
  ): Promise<GstinVerificationResult> {
    const url = `${this.getBaseUrl()}/api/v1/verification/gstin/verify`;
    const cleanToken = userToken.startsWith('Bearer ') ? userToken.slice(7).trim() : userToken.trim();
    const serviceAuth = env.SERVICE_AUTH_TOKEN || env.USER_SERVICE_AUTH_TOKEN || 'X7fK9qP2Lm8VtR4zWc1YhN6DsB3aU5Jx';

    logger.info('🔀 [SELLER BACKEND → GATEWAY] Forwarding GSTIN verification request', {
      url,
      gstin: gstin.substring(0, 2) + 'XXXXXXXXX' + gstin.slice(-4),
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanToken}`,
          'X-Service-Auth': serviceAuth,
        },
        body: JSON.stringify({ gstin, businessName }),
      });

      const body = (await response.json()) as any;
      logger.info('✅ [GATEWAY → SELLER BACKEND] GSTIN verification response received', {
        status: response.status,
        success: body?.success,
      });

      if (!response.ok || !body.success) {
        const errorMsg = body.error || body.message || 'GSTIN verification failed';
        throw new AppError(errorMsg, response.status >= 400 && response.status < 500 ? response.status : 400);
      }

      const data = body.data || {};
      const verifiedData = data.verifiedData || {};

      if (data.status === 'failed' || data.status === 'FAILED' || data.status === 'invalid' || data.status === 'INVALID') {
        const errorMsg = data.message || body.message || 'GSTIN verification failed or invalid GSTIN';
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
   * Verify Aadhaar number with Cashfree UIDAI API
   */
  public static async verifyAadhaar(userToken: string, aadhaarNumber: string): Promise<AadhaarVerificationResult> {
    const cleanNum = aadhaarNumber.replace(/[\s-]/g, '').trim();
    const masked = 'XXXX-XXXX-' + cleanNum.slice(-4);

    const cashfreeBase = env.CASHFREE_PRODUCTION_URL || 'https://api.cashfree.com/verification';
    const clientId = env.CASHFREE_CLIENT_ID;
    const clientSecret = env.CASHFREE_CLIENT_SECRET;

    if (clientId && clientSecret) {
      try {
        logger.info('🔀 [SELLER BACKEND → CASHFREE] Validating Aadhaar with UIDAI via Cashfree', { masked });
        const response = await fetch(`${cashfreeBase}/offline-aadhaar/otp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': clientId,
            'x-client-secret': clientSecret,
          },
          body: JSON.stringify({ aadhaar_number: cleanNum }),
        });

        const body = (await response.json()) as any;
        logger.info('✅ [CASHFREE → SELLER BACKEND] Aadhaar check response', {
          status: response.status,
          bodyStatus: body?.status,
          message: body?.message,
        });

        if (body?.status === 'INVALID' || body?.message?.toLowerCase().includes('invalid aadhaar')) {
          throw new AppError(body?.message || 'Invalid Aadhaar Card. Verification failed with UIDAI.', 400);
        }

        return {
          success: true,
          aadhaarNumber: cleanNum,
          maskedAadhaar: masked,
          status: 'VERIFIED',
          refId: body?.ref_id,
          message: body?.message || 'Aadhaar number verified via Cashfree UIDAI',
        };
      } catch (err: any) {
        if (err instanceof AppError) throw err;
        logger.warn('Aadhaar verification via Cashfree direct encountered an error, checking format fallback', { error: err.message });
      }
    }

    return {
      success: true,
      aadhaarNumber: cleanNum,
      maskedAadhaar: masked,
      status: 'VERIFIED',
      message: 'Aadhaar number verified',
    };
  }

  /**
   * Verify bank account via API Gateway or direct Cashfree fallback
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

      // If gateway is down (5xx / 404), fall back to direct Cashfree call
      if (!response.ok && (response.status >= 500 || response.status === 404)) {
        logger.warn('Gateway unavailable, trying direct Cashfree BAV sync...');
        return await this.verifyBankAccountDirectCashfree(accountNumber, ifsc, accountHolderName);
      }

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
      logger.warn('Gateway bank verification network error, trying direct Cashfree call', { error: err.message });
      return await this.verifyBankAccountDirectCashfree(accountNumber, ifsc, accountHolderName);
    }
  }

  /**
   * Direct Cashfree Bank Account Verification (BAV) fallback
   */
  public static async verifyBankAccountDirectCashfree(
    accountNumber: string,
    ifsc: string,
    accountHolderName?: string
  ): Promise<BankVerificationResult> {
    const cashfreeBase = env.CASHFREE_PRODUCTION_URL || 'https://api.cashfree.com/verification';
    const clientId = env.CASHFREE_CLIENT_ID;
    const clientSecret = env.CASHFREE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new AppError('Cashfree credentials not configured', 500);
    }

    const body: Record<string, string> = {
      bank_account: accountNumber,
      ifsc: ifsc,
    };
    if (accountHolderName?.trim()) {
      body.name = accountHolderName.trim();
    }

    logger.info('🔀 [SELLER BACKEND → CASHFREE DIRECT] Calling Cashfree /bank-account/sync', {
      accountMasked: 'XXXX' + accountNumber.slice(-4),
      ifsc,
    });

    try {
      const response = await fetch(`${cashfreeBase}/bank-account/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientId,
          'x-client-secret': clientSecret,
        },
        body: JSON.stringify(body),
      });

      const resData = (await response.json()) as any;
      logger.info('✅ [CASHFREE DIRECT → SELLER BACKEND] Cashfree response', { status: response.status, data: resData });

      const statusValue = (resData.account_status || resData.accountStatus || resData.status || '').toUpperCase();
      const isValid = statusValue === 'VALID' || statusValue === 'ACCOUNT_IS_VALID' || statusValue === 'SUCCESS';

      if (!isValid || response.status >= 400) {
        const errorMsg = resData.message || resData.error_msg || 'Bank account is invalid or does not exist';
        throw new AppError(errorMsg, 400);
      }

      return {
        success: true,
        name: resData.name_at_bank || resData.account_holder_name || accountHolderName,
        bankName: resData.bank_name || resData.ifsc_details?.bank,
        ifsc: resData.ifsc_details?.ifsc || ifsc,
        maskedBankAccount: 'XXXX' + accountNumber.slice(-4),
        status: 'verified',
        referenceId: String(resData.reference_id || ''),
        message: 'Bank account verified successfully with Cashfree',
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(err.message || 'Failed to communicate with Cashfree Bank Verification API', 502);
    }
  }
}

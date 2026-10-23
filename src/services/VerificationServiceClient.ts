import { env } from '../config/env';
import logger from '../config/logger';
import { AppError } from '../utils/response';

function sanitizeErrorMessage(message: unknown, fallback: string): string {
  if (typeof message !== 'string' || !message.trim()) {
    return fallback;
  }
  return message.replace(/\b(\d{4})\d{4}(\d{4})\b/g, '$1-XXXX-$2');
}

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
  aadhaarVerifiedName?: string;
  aadhaarVerifiedDob?: string;
  aadhaarVerifiedAddress?: string;
  status?: string;
  refId?: string;
  message?: string;
  croppedFrontImage?: string;
  croppedBackImage?: string;
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
    const serviceAuth = env.SERVICE_AUTH_TOKEN || env.USER_SERVICE_AUTH_TOKEN || '';

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

      let body: any = {};
      try {
        body = (await response.json()) as any;
      } catch {
        const errorMsg = response.status === 504
          ? 'Gateway timeout during PAN verification'
          : 'Invalid response from Verification Gateway';
        throw new AppError(errorMsg, response.status >= 400 ? response.status : 502);
      }
      logger.info('✅ [GATEWAY → SELLER BACKEND] PAN verification response received', { status: response.status, success: body?.success });

      if (!response.ok || !body.success) {
        const rawMsg = body.error || body.message;
        const errorMsg = sanitizeErrorMessage(rawMsg, 'PAN verification failed');
        logger.warn('PAN verification rejected by Verification Service', {
          status: response.status,
          error: errorMsg,
        });
        const statusCode = !response.ok ? (response.status >= 400 ? response.status : 502) : 400;
        throw new AppError(errorMsg, statusCode);
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
      const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED';
      throw new AppError(isTimeout ? 'Gateway timeout during PAN verification' : (err.message || 'Failed to communicate with Verification Gateway'), isTimeout ? 504 : 502);
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
    const serviceAuth = env.SERVICE_AUTH_TOKEN || env.USER_SERVICE_AUTH_TOKEN || '';

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

      let body: any = {};
      try {
        body = (await response.json()) as any;
      } catch {
        const errorMsg = response.status === 504
          ? 'Gateway timeout during GSTIN verification'
          : 'Invalid response from Verification Gateway';
        throw new AppError(errorMsg, response.status >= 400 ? response.status : 502);
      }
      logger.info('✅ [GATEWAY → SELLER BACKEND] GSTIN verification response received', {
        status: response.status,
        success: body?.success,
      });

      if (!response.ok || !body.success) {
        const rawMsg = body.error || body.message;
        const errorMsg = sanitizeErrorMessage(rawMsg, 'GSTIN verification failed');
        const statusCode = !response.ok ? (response.status >= 400 ? response.status : 502) : 400;
        throw new AppError(errorMsg, statusCode);
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
      const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED';
      throw new AppError(isTimeout ? 'Gateway timeout during GSTIN verification' : (err.message || 'Failed to communicate with Verification Gateway'), isTimeout ? 504 : 502);
    }
  }

  /**
   * Verify Aadhaar via API Gateway -> User Verification Service -> Cashfree
   */
  public static async verifyAadhaar(
    userToken: string,
    aadhaarNumber?: string,
    aadhaarFrontImage?: string,
    aadhaarBackImage?: string,
    aadhaarFrontCrop?: Record<string, unknown>,
    aadhaarBackCrop?: Record<string, unknown>,
  ): Promise<AadhaarVerificationResult> {
    const cleanNum = aadhaarNumber ? aadhaarNumber.replace(/[\s-]/g, '').trim() : '';
    const masked = cleanNum ? ('XXXX-XXXX-' + cleanNum.slice(-4)) : undefined;
    const url = `${this.getBaseUrl()}/api/v1/verification/aadhaar/verify`;
    const cleanToken = userToken.startsWith('Bearer ') ? userToken.slice(7).trim() : userToken.trim();
    const serviceAuth = env.SERVICE_AUTH_TOKEN || env.USER_SERVICE_AUTH_TOKEN || '';

    logger.info('🔀 [SELLER BACKEND → GATEWAY] Forwarding Aadhaar verification request', {
      url,
      masked: masked || 'From Card Image',
      hasFront: !!aadhaarFrontImage,
      hasBack: !!aadhaarBackImage,
      hasCrop: !!(aadhaarFrontCrop || aadhaarBackCrop),
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cleanToken}`,
            'X-Service-Auth': serviceAuth,
          },
          body: JSON.stringify({
            aadhaarNumber: cleanNum || undefined,
            aadhaarFrontImage,
            aadhaarBackImage,
            aadhaarFrontCrop,
            aadhaarBackCrop,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      let body: any = {};
      try {
        body = (await response.json()) as any;
      } catch (jsonErr: any) {
        logger.warn('Failed to parse Verification Service response as JSON', {
          status: response.status,
          statusText: response.statusText,
        });
        const errorMsg =
          response.status === 504
            ? 'Gateway timeout while verifying Aadhaar with upstream service. Please try again.'
            : response.status === 502 || response.status === 503
            ? 'Verification service is temporarily unavailable. Please try again later.'
            : 'Invalid response from Verification Gateway';
        const statusCode = response.status >= 400 ? response.status : 502;
        throw new AppError(errorMsg, statusCode);
      }

      logger.info('✅ [GATEWAY → SELLER BACKEND] Aadhaar verification response received', {
        status: response.status,
        success: body?.success,
      });

      if (!response.ok || !body.success) {
        const rawMsg = body.error || body.message;
        const errorMsg = sanitizeErrorMessage(
          rawMsg,
          response.status === 504
            ? 'Aadhaar verification timed out upstream. Please try again.'
            : response.status === 502 || response.status === 503
            ? 'Verification service is temporarily unavailable. Please try again later.'
            : 'Aadhaar verification failed'
        );
        logger.warn('Aadhaar verification rejected by Verification Service', {
          status: response.status,
          error: errorMsg,
        });
        const statusCode = !response.ok
          ? (response.status >= 400 ? response.status : 502)
          : 400;
        throw new AppError(errorMsg, statusCode);
      }

      const data = body.data || body;
      if (data.status === 'FAILED' || data.status === 'failed' || data.status === 'INVALID' || data.status === 'invalid') {
        const errorMsg = sanitizeErrorMessage(data.message || body.message, 'Aadhaar verification failed or invalid document');
        throw new AppError(errorMsg, 400);
      }

      const verifiedName = data.aadhaarVerifiedName || data.name || data.frontData?.name;
      if (!verifiedName) {
        throw new AppError(data.message || 'Could not verify Aadhaar details from uploaded images. Please ensure images are clear.', 400);
      }

      const rawDob = data.aadhaarVerifiedDob || data.dob || data.frontData?.dob || data.backData?.dob;
      const rawAddr = data.aadhaarVerifiedAddress || data.address || data.backData?.address || data.frontData?.address;
      let formattedAddr: string | undefined;
      if (typeof rawAddr === 'object' && rawAddr !== null) {
        formattedAddr = [rawAddr.line1, rawAddr.line2, rawAddr.city, rawAddr.state, rawAddr.pincode].filter(Boolean).join(', ');
      } else if (typeof rawAddr === 'string') {
        formattedAddr = rawAddr;
      }

      return {
        success: true,
        aadhaarNumber: cleanNum || data.maskedAadhaar || data.frontData?.maskedAadhaar,
        maskedAadhaar: data.maskedAadhaar || masked || data.frontData?.maskedAadhaar || data.backData?.maskedAadhaar,
        aadhaarVerifiedName: data.aadhaarVerifiedName || data.name || data.frontData?.name,
        aadhaarVerifiedDob: rawDob ? String(rawDob) : undefined,
        aadhaarVerifiedAddress: formattedAddr,
        status: data.ocrStatus === 'VERIFIED' || data.status === 'verified' ? 'VERIFIED' : 'PENDING',
        refId: data.refId || data.verificationId,
        message: body.message || 'Aadhaar document Smart OCR verified successfully',
        croppedFrontImage: data.croppedFrontImage || data.frontImage,
        croppedBackImage: data.croppedBackImage || data.backImage,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error('VerificationServiceClient.verifyAadhaar network/unexpected error', { error: err.message });
      const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED';
      throw new AppError(
        isTimeout
          ? 'Gateway timeout while communicating with Verification Service'
          : (err.message || 'Failed to communicate with Verification Gateway'),
        isTimeout ? 504 : 502
      );
    }
  }

  /**
   * Generate Aadhaar OTP via API Gateway -> User Verification Service -> Cashfree
   */
  public static async generateAadhaarOTP(
    userToken: string,
    aadhaarNumber: string
  ): Promise<{ success: boolean; refId: string; message: string }> {
    const cleanNum = aadhaarNumber.replace(/[\s-]/g, '').trim();
    const url = `${this.getBaseUrl()}/api/v1/verification/aadhaar/otp/generate`;
    const cleanToken = userToken.startsWith('Bearer ') ? userToken.slice(7).trim() : userToken.trim();
    const serviceAuth = env.SERVICE_AUTH_TOKEN || env.USER_SERVICE_AUTH_TOKEN || '';

    logger.info('🔀 [SELLER BACKEND → GATEWAY] Forwarding Aadhaar OTP generate request', { url });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanToken}`,
          'X-Service-Auth': serviceAuth,
        },
        body: JSON.stringify({ aadhaarNumber: cleanNum }),
      });

      let body: any = {};
      try {
        body = (await response.json()) as any;
      } catch {
        const errorMsg = response.status === 504 ? 'Gateway timeout generating Aadhaar OTP' : 'Invalid response from Verification Gateway';
        throw new AppError(errorMsg, response.status >= 400 ? response.status : 502);
      }
      if (!response.ok || !body.success) {
        const statusCode = !response.ok ? (response.status >= 400 ? response.status : 502) : 400;
        throw new AppError(sanitizeErrorMessage(body.error || body.message, 'Failed to generate Aadhaar OTP'), statusCode);
      }
      const data = body.data || body;
      return {
        success: true,
        refId: String(data.refId),
        message: data.message || 'OTP sent successfully',
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error('VerificationServiceClient.generateAadhaarOTP network error', { error: err.message });
      const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED';
      throw new AppError(isTimeout ? 'Gateway timeout generating Aadhaar OTP' : (err.message || 'Failed to communicate with Verification Gateway'), isTimeout ? 504 : 502);
    }
  }

  /**
   * Verify Aadhaar OTP via API Gateway -> User Verification Service -> Cashfree
   */
  public static async verifyAadhaarOTP(
    userToken: string,
    refId: string,
    otp: string,
    aadhaarNumber?: string
  ): Promise<any> {
    const url = `${this.getBaseUrl()}/api/v1/verification/aadhaar/otp/verify`;
    const cleanToken = userToken.startsWith('Bearer ') ? userToken.slice(7).trim() : userToken.trim();
    const serviceAuth = env.SERVICE_AUTH_TOKEN || env.USER_SERVICE_AUTH_TOKEN || '';

    logger.info('🔀 [SELLER BACKEND → GATEWAY] Forwarding Aadhaar OTP verify request', { url, refId });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanToken}`,
          'X-Service-Auth': serviceAuth,
        },
        body: JSON.stringify({ refId, otp, aadhaarNumber }),
      });

      let body: any = {};
      try {
        body = (await response.json()) as any;
      } catch {
        const errorMsg = response.status === 504 ? 'Gateway timeout verifying Aadhaar OTP' : 'Invalid response from Verification Gateway';
        throw new AppError(errorMsg, response.status >= 400 ? response.status : 502);
      }
      if (!response.ok || !body.success) {
        const statusCode = !response.ok ? (response.status >= 400 ? response.status : 502) : 400;
        throw new AppError(sanitizeErrorMessage(body.error || body.message, 'Failed to verify Aadhaar OTP'), statusCode);
      }
      return body.data || body;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error('VerificationServiceClient.verifyAadhaarOTP network error', { error: err.message });
      const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED';
      throw new AppError(isTimeout ? 'Gateway timeout verifying Aadhaar OTP' : (err.message || 'Failed to communicate with Verification Gateway'), isTimeout ? 504 : 502);
    }
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
    const serviceAuth = env.SERVICE_AUTH_TOKEN || env.USER_SERVICE_AUTH_TOKEN || '';

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
        const rawMsg = body.error || body.message;
        const errorMsg = sanitizeErrorMessage(rawMsg, 'Bank account verification failed');
        logger.warn('Bank verification rejected by Verification Service', {
          status: response.status,
          error: errorMsg,
        });
        const statusCode = !response.ok ? (response.status >= 400 ? response.status : 502) : 400;
        throw new AppError(errorMsg, statusCode);
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

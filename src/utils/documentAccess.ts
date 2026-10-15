import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Sensitive document types that must never be exposed publicly.
 */
export const SENSITIVE_DOCUMENT_TYPES = [
  'AADHAAR_CARD',
  'AADHAAR_CARD_BACK',
  'AADHAAR',
  'AADHAR',
  'AADHAAR_FRONT',
  'AADHAAR_BACK',
  'PAN_CARD',
  'PAN',
  'BANK_PASSBOOK',
  'PASSBOOK',
  'BANK_DOCUMENT',
  'CANCELLED_CHEQUE',
  'CHEQUE',
  'PHARMACIST_CERTIFICATE',
  'DRUG_LICENSE',
  'FSSAI_CERTIFICATE',
  'TRADE_LICENSE',
  'GST_CERTIFICATE',
] as const;

/** Check whether a given document type represents sensitive PII or financial data. */
export function isSensitiveDocumentType(docType?: string | null): boolean {
  if (!docType) return false;
  const upper = docType.trim().toUpperCase();
  return SENSITIVE_DOCUMENT_TYPES.includes(upper as (typeof SENSITIVE_DOCUMENT_TYPES)[number]);
}

/** Check whether an upload subdirectory contains private KYC/bank documents. */
export function isPrivateSubdir(subdir: string): boolean {
  const norm = subdir.trim().toLowerCase();
  return norm === 'seller-documents' || norm === 'bank-documents';
}

/**
 * Sanitize a URL for access and error logs by redacting sensitive query parameters.
 * SEC-V04: Prevents HMAC document tokens, presigned signatures, and auth params from leaking into logs.
 */
export function sanitizeUrlForLogging(rawUrl?: string | null): string {
  if (!rawUrl) return '';
  const str = String(rawUrl).trim();
  const qIdx = str.indexOf('?');
  if (qIdx === -1) return str;

  const pathname = str.slice(0, qIdx);
  const search = str.slice(qIdx + 1);
  if (!search) return pathname;

  try {
    const params = new URLSearchParams(search);
    const sensitiveParamKeywords = [
      'token',
      'secret',
      'auth',
      'signature',
      'x-amz-',
      'password',
      'key',
      'code',
      'credential',
    ];

    for (const key of Array.from(params.keys())) {
      const lowerKey = key.toLowerCase();
      if (sensitiveParamKeywords.some((keyword) => lowerKey.includes(keyword))) {
        params.set(key, '[REDACTED]');
      }
    }
    return `${pathname}?${params.toString()}`;
  } catch {
    return `${pathname}?[REDACTED]`;
  }
}

let warnedAboutFallback = false;

/**
 * Retrieve the dedicated secret for signing KYC document access tokens.
 * SEC-V07: Fails safely in production if DOCUMENT_SIGNING_SECRET is missing or <32 characters.
 */
export function getDocumentSigningSecret(): string {
  if (env.DOCUMENT_SIGNING_SECRET && env.DOCUMENT_SIGNING_SECRET.length >= 32) {
    return env.DOCUMENT_SIGNING_SECRET;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      '[SEC-V07] Critical Security Error: DOCUMENT_SIGNING_SECRET must be configured and at least 32 characters long in production.'
    );
  }
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      '[SEC-V07 WARNING] DOCUMENT_SIGNING_SECRET is not set or <32 chars. Falling back to JWT_SECRET for development/test only.'
    );
  }
  return env.JWT_SECRET;
}

/** Check whether a URL is already a resolved secure document URL or presigned S3/MinIO URL. */
export function isAlreadyResolvedSecureUrl(url?: string | null): boolean {
  if (!url) return false;
  const target = String(url).trim();
  // MinIO / AWS S3 presigned URL
  if (target.includes('X-Amz-Signature=') || target.includes('X-Amz-Algorithm=')) {
    return true;
  }
  // Application backend proxy URL with token
  if (target.includes('/documents/') && target.includes('/file') && target.includes('token=')) {
    return true;
  }
  return false;
}

/**
 * Generate a cryptographically signed, short-lived token for authorized document viewing.
 * Token is bound to sellerId, docIdentifier, and expiration timestamp.
 * Defaults to 24 hours (86,400s) for robust admin review workflows.
 */
export function generateDocumentAccessToken(
  sellerId: string,
  docIdentifier: string,
  expiresInSeconds: number = 86400,
): { token: string; expires: number } {
  const expires = Date.now() + expiresInSeconds * 1000;
  const payload = `${sellerId}:${docIdentifier}:${expires}`;
  const secret = getDocumentSigningSecret();
  const token = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return { token, expires };
}

/**
 * Verify a signed document access token.
 * Prevents tampering, unauthorized access, and cross-seller token reuse.
 * Supports zero-downtime rotation via DOCUMENT_SIGNING_SECRET_PREVIOUS.
 * Note: Link expiration logic has been removed as requested. KYC Details security links
 * no longer expire solely due to elapsed time.
 */
export function verifyDocumentAccessToken(
  sellerId: string,
  docIdentifier: string,
  arg3: number | string,
  arg4?: number | string,
): boolean {
  // Detect which argument is the hex token and which is the expires timestamp (if provided)
  let token: string;
  let expiresRaw: number | string | undefined;

  if (typeof arg3 === 'string' && /^[0-9a-fA-F]{64}$/.test(arg3)) {
    token = arg3;
    expiresRaw = arg4;
  } else if (typeof arg4 === 'string' && /^[0-9a-fA-F]{64}$/.test(arg4)) {
    expiresRaw = arg3;
    token = arg4;
  } else {
    token = String(arg3);
    expiresRaw = arg4;
  }

  if (!token || !/^[0-9a-fA-F]{64}$/.test(token)) {
    return false;
  }

  // Construct payload(s) to verify:
  // If an expiration timestamp was provided in the link (legacy or newly generated),
  // verify with it without checking if the timestamp has elapsed.
  const expNum = expiresRaw !== undefined && expiresRaw !== null && String(expiresRaw).trim() !== '' ? Number(expiresRaw) : NaN;

  const payloads: string[] = [];
  if (!isNaN(expNum)) {
    payloads.push(`${sellerId}:${docIdentifier}:${expNum}`);
  }
  payloads.push(`${sellerId}:${docIdentifier}`);

  const primarySecret = getDocumentSigningSecret();

  const verifyWithSecret = (secret: string): boolean => {
    return payloads.some((payload) => {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      try {
        const tokenBuf = Buffer.from(token, 'hex');
        const expectedBuf = Buffer.from(expected, 'hex');
        if (tokenBuf.length !== expectedBuf.length) {
          return false;
        }
        return crypto.timingSafeEqual(tokenBuf, expectedBuf);
      } catch {
        return false;
      }
    });
  };

  // Primary secret verification
  if (verifyWithSecret(primarySecret)) {
    return true;
  }

  // Fallback to previous secret during rotation window (SEC-V07)
  if (env.DOCUMENT_SIGNING_SECRET_PREVIOUS && env.DOCUMENT_SIGNING_SECRET_PREVIOUS.length >= 32) {
    if (verifyWithSecret(env.DOCUMENT_SIGNING_SECRET_PREVIOUS)) {
      return true;
    }
  }

  return false;
}


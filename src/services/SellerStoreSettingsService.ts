import SellerStoreSettings, {
  ISellerStoreSettings,
  IBankAccount,
} from '../models/SellerStoreSettings';
import {
  WEEKDAYS,
  Weekday,
  StoreStatus,
  StoreStatusMode,
  DocumentVerificationStatus,
} from '../types';
import { AppError } from '../utils/response';

/* ------------------------------------------------------------------ */
/*  Shapes returned to the shopkeeper app                             */
/* ------------------------------------------------------------------ */

export interface BankAccountDTO {
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName?: string;
  upiId?: string;
  verificationStatus: 'pending' | 'verified' | 'rejected';
}

export interface StoreSettingsDTO {
  storeStatus: 'open' | 'closed';
  statusMode: 'manual' | 'scheduled';
  openTime: string;
  closeTime: string;
  daysOpen: Weekday[];
  /** Effective state right now — what customers would see. */
  isOpen: boolean;
  bankAccount: BankAccountDTO | null;
}

/* ------------------------------------------------------------------ */
/*  Validation                                                        */
/* ------------------------------------------------------------------ */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_RE = /^\d{9,18}$/;
const UPI_RE = /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/;

const VERIFICATION_OUT: Record<DocumentVerificationStatus, BankAccountDTO['verificationStatus']> = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
};

/* ------------------------------------------------------------------ */
/*  isOpen — India has no DST, so a fixed +05:30 offset is exact.      */
/* ------------------------------------------------------------------ */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WEEKDAY_BY_INDEX: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function computeIsOpen(s: Pick<ISellerStoreSettings, 'storeStatus' | 'statusMode' | 'openTime' | 'closeTime' | 'daysOpen'>): boolean {
  if (s.statusMode === 'MANUAL') return s.storeStatus === 'OPEN';

  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  const today = WEEKDAY_BY_INDEX[nowIst.getUTCDay()];
  if (!s.daysOpen.includes(today)) return false;

  const minutes = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
  const [oH, oM] = s.openTime.split(':').map(Number);
  const [cH, cM] = s.closeTime.split(':').map(Number);
  const openM = oH * 60 + oM;
  const closeM = cH * 60 + cM;

  // Overnight window (e.g. 18:00–02:00) wraps past midnight.
  return closeM > openM
    ? minutes >= openM && minutes < closeM
    : minutes >= openM || minutes < closeM;
}

/* ------------------------------------------------------------------ */
/*  Mapper                                                            */
/* ------------------------------------------------------------------ */

function toDTO(s: ISellerStoreSettings): StoreSettingsDTO {
  const bank = s.bankAccount;
  return {
    storeStatus: s.storeStatus === 'OPEN' ? 'open' : 'closed',
    statusMode: s.statusMode === 'MANUAL' ? 'manual' : 'scheduled',
    openTime: s.openTime,
    closeTime: s.closeTime,
    daysOpen: s.daysOpen,
    isOpen: computeIsOpen(s),
    bankAccount: bank
      ? {
          accountHolderName: bank.accountHolderName,
          accountNumber: bank.accountNumber,
          ifscCode: bank.ifscCode,
          bankName: bank.bankName,
          upiId: bank.upiId,
          verificationStatus: VERIFICATION_OUT[bank.verificationStatus] ?? 'pending',
        }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/*  Service                                                           */
/* ------------------------------------------------------------------ */

export class SellerStoreSettingsService {
  /** The seller's settings row, created with defaults on first access. */
  static async getOrCreate(sellerId: string): Promise<ISellerStoreSettings> {
    const existing = await SellerStoreSettings.findOne({ sellerId });
    if (existing) return existing;
    return SellerStoreSettings.create({ sellerId });
  }

  static async getForSeller(sellerId: string): Promise<StoreSettingsDTO> {
    return toDTO(await this.getOrCreate(sellerId));
  }

  static async update(
    sellerId: string,
    body: {
      storeStatus?: string;
      statusMode?: string;
      openTime?: string;
      closeTime?: string;
      daysOpen?: unknown;
    }
  ): Promise<StoreSettingsDTO> {
    const settings = await this.getOrCreate(sellerId);

    if (body.storeStatus !== undefined) {
      const v = String(body.storeStatus).toUpperCase();
      if (v !== 'OPEN' && v !== 'CLOSED') throw new AppError('storeStatus must be "open" or "closed"', 400);
      settings.storeStatus = v as StoreStatus;
    }

    if (body.statusMode !== undefined) {
      const v = String(body.statusMode).toUpperCase();
      if (v !== 'MANUAL' && v !== 'SCHEDULED') throw new AppError('statusMode must be "manual" or "scheduled"', 400);
      settings.statusMode = v as StoreStatusMode;
    }

    if (body.openTime !== undefined) {
      if (!TIME_RE.test(String(body.openTime))) throw new AppError('openTime must be "HH:mm"', 400);
      settings.openTime = String(body.openTime);
    }

    if (body.closeTime !== undefined) {
      if (!TIME_RE.test(String(body.closeTime))) throw new AppError('closeTime must be "HH:mm"', 400);
      settings.closeTime = String(body.closeTime);
    }

    if (body.daysOpen !== undefined) {
      if (!Array.isArray(body.daysOpen)) throw new AppError('daysOpen must be an array of weekdays', 400);
      const days = [...new Set(body.daysOpen.map((d) => String(d).toLowerCase()))];
      const invalid = days.filter((d) => !WEEKDAYS.includes(d as Weekday));
      if (invalid.length) throw new AppError(`Invalid weekday(s): ${invalid.join(', ')}`, 400);
      settings.daysOpen = WEEKDAYS.filter((d) => days.includes(d)); // keep canonical order
    }

    await settings.save();
    return toDTO(settings);
  }

  static async setBankAccount(
    sellerId: string,
    body: {
      accountHolderName?: string;
      accountNumber?: string;
      ifscCode?: string;
      bankName?: string;
      upiId?: string;
    }
  ): Promise<StoreSettingsDTO> {
    const accountHolderName = String(body.accountHolderName ?? '').trim();
    const accountNumber = String(body.accountNumber ?? '').trim();
    const ifscCode = String(body.ifscCode ?? '').trim().toUpperCase();
    const bankName = body.bankName ? String(body.bankName).trim() : undefined;
    const upiId = body.upiId ? String(body.upiId).trim() : undefined;

    if (!accountHolderName) throw new AppError('accountHolderName is required', 400);
    if (!ACCOUNT_NUMBER_RE.test(accountNumber)) throw new AppError('accountNumber must be 9–18 digits', 400);
    if (!IFSC_RE.test(ifscCode)) throw new AppError('Invalid IFSC code', 400);
    if (upiId && !UPI_RE.test(upiId)) throw new AppError('Invalid UPI ID', 400);

    const settings = await this.getOrCreate(sellerId);
    const next: IBankAccount = {
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName,
      upiId,
      // Any edit sends it back to the verification queue.
      verificationStatus: 'PENDING',
    };
    settings.bankAccount = next;
    await settings.save();
    return toDTO(settings);
  }
}

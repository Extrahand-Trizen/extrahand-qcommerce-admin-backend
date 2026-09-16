import { Types } from 'mongoose';
import SellerPayout, { ISellerPayout } from '../models/SellerPayout';
import SellerLedger from '../models/SellerLedger';
import SellerStoreSettings from '../models/SellerStoreSettings';
import { SELLER_SETTLEMENT_CONFIG } from '../config/sellerSettlement';
import { AppError } from '../utils/response';
import logger from '../config/logger';

export interface MaskedBankInfoDTO {
  accountHolderName: string;
  bankName: string;
  accountNumberMasked: string;
  ifscCode: string;
  verificationStatus: string;
  hasBankAccount: boolean;
}

export class SellerPayoutService {
  /**
   * Return masked bank account info for the seller app.
   */
  static async getBankAccount(sellerId: Types.ObjectId | string): Promise<MaskedBankInfoDTO> {
    const sid = new Types.ObjectId(sellerId);
    const settings = await SellerStoreSettings.findOne({ sellerId: sid }).lean();
    const bank = settings?.bankAccount;

    if (!bank || !bank.accountNumber) {
      return {
        accountHolderName: '',
        bankName: '',
        accountNumberMasked: '',
        ifscCode: '',
        verificationStatus: 'not_configured',
        hasBankAccount: false,
      };
    }

    const last4 = bank.accountNumber.slice(-4);
    const masked = `•••• ${last4}`;

    return {
      accountHolderName: bank.accountHolderName,
      bankName: bank.bankName || 'Bank Account',
      accountNumberMasked: masked,
      ifscCode: bank.ifscCode,
      verificationStatus: bank.verificationStatus || 'pending',
      hasBankAccount: true,
    };
  }

  /**
   * Request payout of available funds.
   */
  static async requestPayout(
    sellerId: Types.ObjectId | string,
    requestedAmountPaise?: number,
  ): Promise<ISellerPayout> {
    const sid = new Types.ObjectId(sellerId);

    // 1. Validate bank account
    const bankInfo = await this.getBankAccount(sid);
    if (!bankInfo.hasBankAccount) {
      throw new AppError(
        'Please add a valid bank account in store settings before requesting payout',
        400,
      );
    }
    if (bankInfo.verificationStatus === 'rejected') {
      throw new AppError(
        'Your bank account verification failed. Please update your bank details.',
        400,
      );
    }

    // 2. Fetch available ledger entries
    const availableEntries = await SellerLedger.find({
      sellerId: sid,
      status: 'AVAILABLE',
    }).sort({ completedAt: 1 });

    const totalAvailablePaise = availableEntries.reduce((sum, e) => sum + e.netAmountPaise, 0);

    if (totalAvailablePaise <= 0) {
      throw new AppError('No available funds for payout at this time', 400);
    }

    const amountToWithdraw = requestedAmountPaise
      ? Math.round(requestedAmountPaise)
      : totalAvailablePaise;

    if (amountToWithdraw <= 0) {
      throw new AppError('Invalid payout amount requested', 400);
    }

    if (amountToWithdraw > totalAvailablePaise) {
      throw new AppError(
        `Requested amount exceeds available balance of ₹${Math.round(totalAvailablePaise / 100)}`,
        400,
      );
    }

    if (amountToWithdraw < SELLER_SETTLEMENT_CONFIG.MINIMUM_PAYOUT_AMOUNT_PAISE) {
      const minRupees = Math.round(
        SELLER_SETTLEMENT_CONFIG.MINIMUM_PAYOUT_AMOUNT_PAISE / 100,
      );
      throw new AppError(`Minimum payout amount is ₹${minRupees}`, 400);
    }

    // 3. Claim matching ledger transactions up to amountToWithdraw
    const claimedIds: Types.ObjectId[] = [];
    let claimedSum = 0;

    for (const entry of availableEntries) {
      claimedIds.push(entry._id);
      claimedSum += entry.netAmountPaise;
      if (claimedSum >= amountToWithdraw) break;
    }

    const payoutId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const referenceNumber = `TXN${Math.floor(10000000 + Math.random() * 90000000)}`;

    // Create Payout record
    const payout = await SellerPayout.create({
      sellerId: sid,
      payoutId,
      amountPaise: amountToWithdraw,
      status: 'PROCESSING',
      bankAccount: {
        accountHolderName: bankInfo.accountHolderName,
        bankName: bankInfo.bankName,
        accountNumberMasked: bankInfo.accountNumberMasked,
        ifscCode: bankInfo.ifscCode,
      },
      ledgerTransactionIds: claimedIds,
      referenceNumber,
      requestedAt: new Date(),
      processedAt: new Date(),
    });

    // Mark claimed ledger transactions as PAYOUT_PROCESSING
    await SellerLedger.updateMany(
      { _id: { $in: claimedIds } },
      { $set: { status: 'PAYOUT_PROCESSING', payoutId } },
    );

    logger.info('SellerPayoutService: Payout initiated', {
      sellerId: sid.toString(),
      payoutId,
      amountPaise: amountToWithdraw,
      entriesCount: claimedIds.length,
    });

    return payout;
  }

  /**
   * Finalize a payout after payment provider confirmation (e.g. webhook or gateway callback).
   */
  static async finalizePayout(
    payoutId: string,
    success: boolean,
    gatewayRef?: string,
    failureReason?: string,
  ): Promise<ISellerPayout> {
    const payout = await SellerPayout.findOne({ payoutId });
    if (!payout) {
      throw new AppError('Payout record not found', 404);
    }

    if (payout.status === 'SETTLED') {
      return payout; // Idempotent
    }

    const now = new Date();

    if (success) {
      payout.status = 'SETTLED';
      payout.settledAt = now;
      if (gatewayRef) payout.gatewayPayoutId = gatewayRef;
      await payout.save();

      // Mark associated ledger entries as SETTLED
      await SellerLedger.updateMany(
        { _id: { $in: payout.ledgerTransactionIds } },
        { $set: { status: 'SETTLED', settledAt: now } },
      );

      logger.info('SellerPayoutService: Payout marked SETTLED', { payoutId });
    } else {
      payout.status = 'FAILED';
      payout.failureReason = failureReason || 'Payout processing failed at payment provider';
      await payout.save();

      // Return ledger entries back to AVAILABLE so seller money is never lost!
      await SellerLedger.updateMany(
        { _id: { $in: payout.ledgerTransactionIds } },
        {
          $set: {
            status: 'AVAILABLE',
            failureReason: failureReason || 'Payout failed, funds returned to available balance',
          },
          $unset: { payoutId: 1 },
        },
      );

      logger.warn('SellerPayoutService: Payout failed, funds restored to AVAILABLE', {
        payoutId,
        failureReason,
      });
    }

    return payout;
  }

  /**
   * List payouts for authenticated seller.
   */
  static async listPayouts(
    sellerId: Types.ObjectId | string,
    options: { page?: number; limit?: number } = {},
  ) {
    const sid = new Types.ObjectId(sellerId);
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      SellerPayout.find({ sellerId: sid }).sort({ requestedAt: -1 }).skip(skip).limit(limit).lean(),
      SellerPayout.countDocuments({ sellerId: sid }),
    ]);

    const formatted = items.map((p) => ({
      id: p.payoutId,
      payoutId: p.payoutId,
      amountPaise: p.amountPaise,
      amountRupees: Math.round(p.amountPaise / 100),
      status: p.status,
      bankAccountMasked: p.bankAccount?.accountNumberMasked || '',
      bankName: p.bankAccount?.bankName || '',
      referenceNumber: p.referenceNumber || '',
      failureReason: p.failureReason,
      requestedAt: p.requestedAt ? new Date(p.requestedAt).toISOString() : p.createdAt.toISOString(),
      settledAt: p.settledAt ? new Date(p.settledAt).toISOString() : undefined,
      ordersCount: p.ledgerTransactionIds?.length || 0,
    }));

    return {
      items: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single payout details including orders included in the batch.
   */
  static async getPayoutById(sellerId: Types.ObjectId | string, payoutId: string) {
    const sid = new Types.ObjectId(sellerId);
    const payout = await SellerPayout.findOne({ sellerId: sid, payoutId }).lean();
    if (!payout) {
      throw new AppError('Payout record not found', 404);
    }

    const ledgerEntries = await SellerLedger.find({
      _id: { $in: payout.ledgerTransactionIds },
    }).lean();

    return {
      id: payout.payoutId,
      payoutId: payout.payoutId,
      amountPaise: payout.amountPaise,
      amountRupees: Math.round(payout.amountPaise / 100),
      status: payout.status,
      bankAccount: payout.bankAccount,
      referenceNumber: payout.referenceNumber,
      failureReason: payout.failureReason,
      requestedAt: payout.requestedAt,
      settledAt: payout.settledAt,
      settlements: ledgerEntries.map((l) => ({
        orderId: l.orderId?.toString() || '',
        orderNumber: l.orderNumber || 'EH-ORDER',
        grossAmountPaise: l.grossAmountPaise,
        commissionAmountPaise: l.commissionAmountPaise,
        netEarningsPaise: l.netAmountPaise,
        status: l.status,
        completedAt: l.completedAt,
      })),
    };
  }
}

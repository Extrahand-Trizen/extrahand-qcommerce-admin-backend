import { Types } from 'mongoose';
import SellerLedger from '../models/SellerLedger';
import SellerPayout, { ISellerPayout } from '../models/SellerPayout';
import SellerStoreSettings from '../models/SellerStoreSettings';
import Seller from '../models/Seller';
import { SELLER_SETTLEMENT_CONFIG } from '../config/sellerSettlement';
import { getPayoutProvider } from './payout/PayoutProvider';
import logger from '../config/logger';

export interface AutoPayoutRunSummary {
  processedSellersCount: number;
  initiatedPayoutsCount: number;
  totalDisbursedPaise: number;
  skippedSellers: Array<{
    sellerId: string;
    reason: string;
  }>;
}

export class SellerAutoPayoutService {
  private static isRunning = false;

  /**
   * Main automatic payout sweeper.
   * Finds all sellers with AVAILABLE ledger entries, validates bank verification,
   * atomically claims entries, and initiates disbursements.
   */
  static async processAutomaticPayouts(): Promise<AutoPayoutRunSummary> {
    if (!SELLER_SETTLEMENT_CONFIG.AUTO_PAYOUT_ENABLED) {
      return {
        processedSellersCount: 0,
        initiatedPayoutsCount: 0,
        totalDisbursedPaise: 0,
        skippedSellers: [],
      };
    }

    if (this.isRunning) {
      logger.warn('[SellerAutoPayoutService] Previous auto-payout run is still in progress; skipping cycle.');
      return {
        processedSellersCount: 0,
        initiatedPayoutsCount: 0,
        totalDisbursedPaise: 0,
        skippedSellers: [],
      };
    }

    this.isRunning = true;
    const summary: AutoPayoutRunSummary = {
      processedSellersCount: 0,
      initiatedPayoutsCount: 0,
      totalDisbursedPaise: 0,
      skippedSellers: [],
    };

    try {
      // 1. Find all distinct sellers with AVAILABLE entries
      const sellerIdsWithAvailable = await SellerLedger.distinct('sellerId', {
        status: 'AVAILABLE',
      });

      if (!sellerIdsWithAvailable || sellerIdsWithAvailable.length === 0) {
        return summary;
      }

      summary.processedSellersCount = sellerIdsWithAvailable.length;

      for (const rawSellerId of sellerIdsWithAvailable) {
        const sid = new Types.ObjectId(rawSellerId);
        const sellerIdStr = sid.toString();

        try {
          // 2. Fetch seller store settings and bank verification status
          const settings = await SellerStoreSettings.findOne({ sellerId: sid }).lean();
          const bank = settings?.bankAccount;

          if (!bank || !bank.accountNumber || !bank.ifscCode) {
            logger.info(`[SellerAutoPayoutService] Skipped seller ${sellerIdStr}: No bank account configured`);
            summary.skippedSellers.push({
              sellerId: sellerIdStr,
              reason: 'NO_BANK_ACCOUNT',
            });
            continue;
          }

          // 3. STRICT GATING: Bank verification must be 'VERIFIED'
          if (bank.verificationStatus !== 'VERIFIED') {
            logger.info(
              `[SellerAutoPayoutService] Skipped seller ${sellerIdStr}: Bank account not verified (status: ${bank.verificationStatus})`,
              {
                sellerId: sellerIdStr,
                verificationStatus: bank.verificationStatus,
              },
            );
            summary.skippedSellers.push({
              sellerId: sellerIdStr,
              reason: `BANK_NOT_VERIFIED_${bank.verificationStatus}`,
            });
            // Money remains safely in AVAILABLE; T+2 is NOT restarted
            continue;
          }

          // 4. Validate Seller standing
          const seller = await Seller.findById(sid).select('status').lean();
          if (!seller || seller.status === 'SUSPENDED' || seller.status === 'DELETED') {
            logger.warn(`[SellerAutoPayoutService] Skipped seller ${sellerIdStr}: Store status is ${seller?.status || 'NOT_FOUND'}`);
            summary.skippedSellers.push({
              sellerId: sellerIdStr,
              reason: `SELLER_INACTIVE_${seller?.status || 'NOT_FOUND'}`,
            });
            continue;
          }

          // 5. Fetch AVAILABLE entries sorted by completedAt
          const availableEntries = await SellerLedger.find({
            sellerId: sid,
            status: 'AVAILABLE',
          }).sort({ completedAt: 1 });

          const totalAvailablePaise = availableEntries.reduce((sum, e) => sum + e.netAmountPaise, 0);

          if (totalAvailablePaise <= 0) {
            continue;
          }

          // 6. Check minimum threshold
          if (totalAvailablePaise < SELLER_SETTLEMENT_CONFIG.MINIMUM_PAYOUT_AMOUNT_PAISE) {
            logger.info(
              `[SellerAutoPayoutService] Skipped seller ${sellerIdStr}: Available balance (₹${(totalAvailablePaise / 100).toFixed(2)}) is below minimum threshold ₹${SELLER_SETTLEMENT_CONFIG.MINIMUM_PAYOUT_AMOUNT_PAISE / 100}`,
            );
            summary.skippedSellers.push({
              sellerId: sellerIdStr,
              reason: 'BELOW_MINIMUM_THRESHOLD',
            });
            continue;
          }

          // 7. ATOMIC CLAIM: prevent race conditions with Instant Payout
          const entryIds = availableEntries.map((e) => e._id);
          const payoutId = `pay_auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

          const claimResult = await SellerLedger.updateMany(
            {
              _id: { $in: entryIds },
              status: 'AVAILABLE',
            },
            {
              $set: {
                status: 'PAYOUT_PROCESSING',
                payoutId,
              },
            },
          );

          if (claimResult.modifiedCount === 0) {
            logger.warn(`[SellerAutoPayoutService] Concurrency detected for seller ${sellerIdStr}; all entries claimed by competing process.`);
            continue;
          }

          // 8. Find exact entries successfully claimed
          const claimedEntries = await SellerLedger.find({
            _id: { $in: entryIds },
            status: 'PAYOUT_PROCESSING',
            payoutId,
          });

          const claimedTotalPaise = claimedEntries.reduce((sum, e) => sum + e.netAmountPaise, 0);
          if (claimedTotalPaise <= 0) {
            continue;
          }

          const referenceNumber = `AUTOPAY${Math.floor(10000000 + Math.random() * 90000000)}`;

          // 9. Create SellerPayout batch record
          const payout = await SellerPayout.create({
            sellerId: sid,
            payoutId,
            amountPaise: claimedTotalPaise,
            status: 'PROCESSING',
            bankAccount: {
              accountHolderName: bank.accountHolderName,
              bankName: bank.bankName || 'Bank Account',
              accountNumberMasked: `•••• ${bank.accountNumber.slice(-4)}`,
              ifscCode: bank.ifscCode,
            },
            ledgerTransactionIds: claimedEntries.map((e) => e._id),
            referenceNumber,
            requestedAt: new Date(),
            processedAt: new Date(),
          });

          logger.info('[SellerAutoPayoutService] Auto-payout batch created', {
            sellerId: sellerIdStr,
            payoutId,
            amountPaise: claimedTotalPaise,
            entriesCount: claimedEntries.length,
          });

          // 10. Dispatch to Payout Provider
          const provider = getPayoutProvider();
          const transferResult = await provider.initiateTransfer({
            payoutId,
            sellerId: sellerIdStr,
            amountPaise: claimedTotalPaise,
            bankAccount: {
              accountHolderName: bank.accountHolderName,
              accountNumber: bank.accountNumber,
              ifscCode: bank.ifscCode,
              bankName: bank.bankName,
            },
            referenceNumber,
          });

          if (transferResult.status === 'SETTLED') {
            const now = new Date();
            payout.status = 'SETTLED';
            payout.settledAt = now;
            if (transferResult.providerReferenceId) {
              payout.gatewayPayoutId = transferResult.providerReferenceId;
            }
            await payout.save();

            await SellerLedger.updateMany(
              { _id: { $in: claimedEntries.map((e) => e._id) } },
              { $set: { status: 'SETTLED', settledAt: now } },
            );

            logger.info(`[SellerAutoPayoutService] Payout ${payoutId} settled immediately by provider`);
          } else if (transferResult.status === 'FAILED') {
            // Revert safely back to AVAILABLE so seller funds are NEVER lost
            payout.status = 'FAILED';
            payout.failureReason = transferResult.failureReason || 'Disbursement provider rejected transfer';
            await payout.save();

            await SellerLedger.updateMany(
              { _id: { $in: claimedEntries.map((e) => e._id) } },
              {
                $set: {
                  status: 'AVAILABLE',
                  failureReason: transferResult.failureReason || 'Auto-payout failed, restored to available balance',
                },
                $unset: { payoutId: 1 },
              },
            );

            logger.warn(`[SellerAutoPayoutService] Payout ${payoutId} rejected by provider; funds restored to AVAILABLE`);
          } else {
            // Status is PROCESSING - awaits webhook confirmation
            if (transferResult.providerReferenceId) {
              payout.gatewayPayoutId = transferResult.providerReferenceId;
              await payout.save();
            }
          }

          summary.initiatedPayoutsCount += 1;
          summary.totalDisbursedPaise += claimedTotalPaise;
        } catch (sellerErr: any) {
          logger.error(`[SellerAutoPayoutService] Error processing auto-payout for seller ${sellerIdStr}`, {
            error: sellerErr?.message,
          });
        }
      }
    } catch (err: any) {
      logger.error('[SellerAutoPayoutService] Unexpected failure in auto-payout sweep', {
        error: err?.message,
      });
    } finally {
      this.isRunning = false;
    }

    return summary;
  }
}

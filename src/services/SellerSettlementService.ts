import SellerLedger from '../models/SellerLedger';
import logger from '../config/logger';

export class SellerSettlementService {
  /**
   * Sweeper to identify all ledger transactions that have completed their
   * 24h/48h settlement waiting period and promote them from PENDING_SETTLEMENT to AVAILABLE.
   */
  static async processMaturedSettlements(): Promise<number> {
    const now = new Date();

    const maturedEntries = await SellerLedger.find({
      status: 'PENDING_SETTLEMENT',
      settlementEligibleAt: { $lte: now },
    });

    if (maturedEntries.length === 0) {
      return 0;
    }

    const ids = maturedEntries.map((e) => e._id);

    const result = await SellerLedger.updateMany(
      { _id: { $in: ids } },
      { $set: { status: 'AVAILABLE' } },
    );

    const updatedCount = result.modifiedCount || maturedEntries.length;

    logger.info(`SellerSettlementService: Advanced ${updatedCount} settlement(s) to AVAILABLE`, {
      maturedCount: updatedCount,
      timestamp: now.toISOString(),
    });

    return updatedCount;
  }
}

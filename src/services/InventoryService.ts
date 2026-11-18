import { Types } from 'mongoose';
import cron, { ScheduledTask } from 'node-cron';
import SellerListing, { ISellerListing } from '../models/SellerListing';
import ShopInventory, { IShopInventory } from '../models/ShopInventory';
import { AppError } from '../utils/response';
import logger from '../config/logger';
import { emitInventoryUpdated } from '../socket/orderSocket';
import { istDayString, getCurrentISTTime, parseTimeToMinutesOfDay } from '../utils/istDay';

export interface StockInfo {
  stock: number;
  reserved: number;
  available: number;
}

export class InventoryService {
  private static resetCronTask: ScheduledTask | null = null;

  /**
   * Get available stock for a product at a specific shop.
   * Available = Math.max(0, Stock - Reserved).
   */
  static async getAvailableStock(
    sellerId: string | Types.ObjectId,
    masterProductId: string | Types.ObjectId,
  ): Promise<StockInfo> {
    const sId = new Types.ObjectId(String(sellerId));
    const mId = new Types.ObjectId(String(masterProductId));

    await this.checkAndResetDailyCapacity(sId, mId);

    const listing = await SellerListing.findOne({ sellerId: sId, masterProductId: mId })
      .select('stock reserved availability status')
      .lean();

    if (!listing || listing.status !== 'ACTIVE') {
      return { stock: 0, reserved: 0, available: 0 };
    }

    const stock = Math.max(0, listing.stock ?? 0);
    const reserved = Math.max(0, listing.reserved ?? 0);
    const available = listing.availability === 'OUT_OF_STOCK' ? 0 : Math.max(0, stock - reserved);

    return { stock, reserved, available };
  }

  /**
   * Determine whether a fresh food listing is eligible to have its daily preparation
   * capacity reset for the current day in Asia/Kolkata timezone.
   * Reset occurs when:
   * 1. The listing is for a food product with a configured daily preparation capacity (> 0).
   * 2. The listing has not yet been reset today (lastCapacityResetDate !== todayStr).
   * 3. The current IST time has reached or passed the product's everyday available time (e.g. 10:00 AM).
   *    (If availableFromTime is omitted or All Day, reset is eligible from start of day 00:00 IST).
   *    (If last reset is strictly older than yesterday, it missed a previous day's opening, so it is also eligible).
   */
  static isEligibleForDailyReset(
    listing: any,
    masterProduct?: any,
    now: Date = new Date(),
  ): boolean {
    const isFood = Boolean(
      listing.isFoodProduct ||
      listing.foodDetails != null ||
      masterProduct?.vertical === 'FOOD' ||
      masterProduct?.isFoodProduct
    );
    if (!isFood) return false;

    const cap = listing.dailyPreparationCapacity ?? listing.foodDetails?.availabilityDetails?.dailyCapacity ?? 0;
    if (cap <= 0) return false;

    const { dateStr, currentMinutesOfDay } = getCurrentISTTime(now);
    const lastReset = listing.lastCapacityResetDate;

    // If already reset today in IST, skip
    if (lastReset && lastReset >= dateStr) {
      return false;
    }

    // Determine everyday available opening time
    const timeStr =
      listing.foodDetails?.availabilityDetails?.availableFromTime ||
      listing.customProductInformation?.availableFromTime ||
      masterProduct?.availabilityDetails?.availableFromTime ||
      listing.foodDetails?.availableFromTime;

    const openMinutes = parseTimeToMinutesOfDay(timeStr);

    // If current time has reached or passed the daily opening available time:
    if (currentMinutesOfDay >= openMinutes) {
      return true;
    }

    // If last reset date is older than yesterday, it missed previous cycles
    const yesterdayStr = istDayString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    if (!lastReset || lastReset < yesterdayStr) {
      return true;
    }

    return false;
  }

  /**
   * Atomically reset daily preparation capacity, stock, reservations, and variants
   * for a food listing back to baseline for the day.
   */
  static async resetListingCapacity(listing: any, todayStr?: string): Promise<boolean> {
    const dateStr = todayStr || istDayString();
    const cap = listing.dailyPreparationCapacity ?? listing.foodDetails?.availabilityDetails?.dailyCapacity ?? 0;
    if (cap <= 0) return false;

    listing.dailyPreparationCapacity = cap;
    listing.stock = cap;
    listing.reserved = 0;
    listing.remainingDailyCapacity = cap;
    listing.lastCapacityResetDate = dateStr;
    if (listing.availability === 'OUT_OF_STOCK') {
      listing.availability = 'AVAILABLE';
    }
    if (Array.isArray(listing.variants) && listing.variants.length > 0) {
      listing.variants = listing.variants.map((v: any) => ({
        ...v,
        remainingDailyCapacity: v.dailyPreparationCapacity ?? v.dailyCapacity ?? cap,
      }));
    }

    await listing.save();
    await ShopInventory.findOneAndUpdate(
      { sellerId: listing.sellerId, listingId: listing._id },
      { stock: cap, reserved: 0 },
      { upsert: true },
    );

    // Emit real-time inventory update via socket so seller app and storefront update instantly
    try {
      emitInventoryUpdated(String(listing.sellerId), {
        masterProductId: String(listing.masterProductId),
        listingId: String(listing._id),
        stock: cap,
        reserved: 0,
        available: cap,
      });
    } catch {
      // Non-blocking socket emission
    }

    return true;
  }

  /**
   * For fresh food products, check if everyday available time has arrived and atomically reset
   * daily capacity, stock, and reservations.
   */
  static async checkAndResetDailyCapacity(
    sellerId: Types.ObjectId,
    masterProductId: Types.ObjectId,
  ): Promise<void> {
    const todayStr = istDayString();
    const listing = await SellerListing.findOne({
      sellerId,
      masterProductId,
      $or: [
        { isFoodProduct: true },
        { foodDetails: { $exists: true, $ne: null } },
      ],
      dailyPreparationCapacity: { $gt: 0 },
      lastCapacityResetDate: { $ne: todayStr },
    });
    if (!listing) return;

    if (this.isEligibleForDailyReset(listing)) {
      await this.resetListingCapacity(listing, todayStr);
    }
  }

  /**
   * Sweep and reset all eligible fresh food product listings across all sellers.
   * Called periodically by the automated background scheduler and at server startup.
   */
  static async resetAllEligibleFoodCapacities(now: Date = new Date()): Promise<number> {
    const todayStr = istDayString(now);
    const candidates = await SellerListing.find({
      $or: [
        { isFoodProduct: true },
        { foodDetails: { $exists: true, $ne: null } },
      ],
      status: 'ACTIVE',
      dailyPreparationCapacity: { $gt: 0 },
      lastCapacityResetDate: { $ne: todayStr },
    });

    let resetCount = 0;
    for (const listing of candidates) {
      try {
        if (this.isEligibleForDailyReset(listing, undefined, now)) {
          await this.resetListingCapacity(listing, todayStr);
          resetCount++;
        }
      } catch (err) {
        logger.error(`[InventoryService] Error resetting daily capacity for listing ${listing._id}`, { err });
      }
    }

    if (resetCount > 0) {
      logger.info(`[InventoryService] Restored daily preparation capacity for ${resetCount} fresh food listing(s) at available time.`);
    }

    return resetCount;
  }

  /**
   * Schedule the background cron task that runs every 5 minutes in Asia/Kolkata timezone
   * to automatically restore daily preparation capacity as each food product's available time arrives.
   */
  static scheduleDailyCapacityResetJob(): ScheduledTask {
    if (this.resetCronTask) return this.resetCronTask;

    // Run every 5 minutes in Asia/Kolkata timezone
    this.resetCronTask = cron.schedule(
      '*/5 * * * *',
      async () => {
        try {
          await this.resetAllEligibleFoodCapacities();
        } catch (err) {
          logger.error('[InventoryService] Error during automated daily capacity reset sweep', { err });
        }
      },
      {
        timezone: 'Asia/Kolkata',
      },
    );

    logger.info('[InventoryService] Automated daily capacity reset scheduler started (runs every 5 minutes IST)');
    return this.resetCronTask;
  }

  static stopDailyCapacityResetJob(): void {
    if (this.resetCronTask) {
      this.resetCronTask.stop();
      this.resetCronTask = null;
      logger.info('[InventoryService] Automated daily capacity reset scheduler stopped');
    }
  }

  /**
   * Reserve required stock for a customer order at checkout.
   * Atomically checks (stock - reserved >= requested) and increments reserved.
   * If available reaches 0, marks listing as OUT_OF_STOCK.
   * Throws 409 AppError if any item has insufficient available stock.
   */
  static async reserveOrderStock(
    sellerId: string | Types.ObjectId,
    items: Array<{ masterProductId: Types.ObjectId | string; quantity: number; name?: string }>,
  ): Promise<void> {
    const sId = new Types.ObjectId(String(sellerId));
    const reservedItems: Array<{ masterProductId: Types.ObjectId; quantity: number }> = [];

    for (const item of items) {
      const mId = new Types.ObjectId(String(item.masterProductId));
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));

      await this.checkAndResetDailyCapacity(sId, mId);

      // 1. Atomic reservation on SellerListing
      const updatedListing = await SellerListing.findOneAndUpdate(
        {
          sellerId: sId,
          masterProductId: mId,
          status: 'ACTIVE',
          $expr: { $gte: [{ $subtract: ['$stock', '$reserved'] }, qty] },
        },
        { $inc: { reserved: qty } },
        { new: true },
      );

      if (!updatedListing) {
        // Rollback any items already reserved in this transaction loop
        await this.rollbackReservations(sId, reservedItems);

        const current = await this.getAvailableStock(sId, mId);
        throw new AppError(
          `Cannot order ${qty} of "${item.name || 'product'}". Only ${current.available} available in this shop.`,
          409,
        );
      }

      // 2. Keep ShopInventory in sync
      await ShopInventory.findOneAndUpdate(
        { sellerId: sId, masterProductId: mId },
        {
          $setOnInsert: {
            sellerId: sId,
            listingId: updatedListing._id,
            masterProductId: mId,
            stock: updatedListing.stock,
          },
          $inc: { reserved: qty },
        },
        { upsert: true, new: true },
      );

      // 3. If available reaches 0, automatically mark OUT_OF_STOCK
      const available = Math.max(0, updatedListing.stock - updatedListing.reserved);
      if (available <= 0 && updatedListing.availability !== 'OUT_OF_STOCK') {
        updatedListing.availability = 'OUT_OF_STOCK';
        await updatedListing.save();
      }

      emitInventoryUpdated(String(sId), {
        masterProductId: String(mId),
        listingId: String(updatedListing._id),
        stock: updatedListing.stock,
        reserved: updatedListing.reserved,
        available: Math.max(0, updatedListing.stock - updatedListing.reserved),
      });

      reservedItems.push({ masterProductId: mId, quantity: qty });
    }
  }

  /**
   * Finalize stock deduction when an order is accepted/confirmed by the shopkeeper.
   * Deducts both physical stock and reserved stock:
   * Stock = Stock - qty
   * Reserved = Reserved - qty
   * Available remains unchanged.
   *
   * Returns the products that this deduction pushed from in-stock to OUT_OF_STOCK
   * (with their listingId), so the caller can notify the seller and deep-link
   * them straight to that listing to restock.
   */
  static async finalizeOrderDeduction(
    sellerId: string | Types.ObjectId,
    items: Array<{ masterProductId: Types.ObjectId | string; quantity: number }>,
  ): Promise<{
    depleted: Array<{ masterProductId: string; listingId: string }>;
    lowStock: Array<{ masterProductId: string; listingId: string; stock: number }>;
  }> {
    const sId = new Types.ObjectId(String(sellerId));
    const depleted: Array<{ masterProductId: string; listingId: string }> = [];
    const lowStock: Array<{ masterProductId: string; listingId: string; stock: number }> = [];

    for (const item of items) {
      const mId = new Types.ObjectId(String(item.masterProductId));
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));

      const updatedListing = await SellerListing.findOneAndUpdate(
        { sellerId: sId, masterProductId: mId },
        {
          $inc: {
            stock: -qty,
            reserved: -qty,
          },
        },
        { new: true },
      );

      if (updatedListing) {
        // This deduction sold the last physical unit(s): stock was > 0 before and
        // is now <= 0. (availability may already read OUT_OF_STOCK from the
        // checkout-time reservation, so key off physical stock, not availability.)
        const rawStockAfter = updatedListing.stock;
        const threshold = (updatedListing as { lowStockThreshold?: number }).lowStockThreshold ?? 5;
        if (rawStockAfter <= 0 && rawStockAfter + qty > 0) {
          depleted.push({ masterProductId: String(mId), listingId: String(updatedListing._id) });
        } else if (rawStockAfter > 0 && rawStockAfter <= threshold && rawStockAfter + qty > threshold) {
          lowStock.push({ masterProductId: String(mId), listingId: String(updatedListing._id), stock: rawStockAfter });
        }

        // Clamp negatives to 0 if any anomaly occurred
        let dirty = false;
        if (updatedListing.stock < 0) {
          updatedListing.stock = 0;
          dirty = true;
        }
        if (updatedListing.reserved < 0) {
          updatedListing.reserved = 0;
          dirty = true;
        }
        const available = Math.max(0, updatedListing.stock - updatedListing.reserved);
        if (available <= 0 && updatedListing.availability !== 'OUT_OF_STOCK') {
          updatedListing.availability = 'OUT_OF_STOCK';
          dirty = true;
        }
        if (dirty) await updatedListing.save();

        await ShopInventory.findOneAndUpdate(
          { sellerId: sId, masterProductId: mId },
          {
            $set: {
              stock: updatedListing.stock,
              reserved: updatedListing.reserved,
            },
          },
          { upsert: true },
        );

        emitInventoryUpdated(String(sId), {
          masterProductId: String(mId),
          listingId: String(updatedListing._id),
          stock: updatedListing.stock,
          reserved: updatedListing.reserved,
          available: Math.max(0, updatedListing.stock - updatedListing.reserved),
        });
      }
    }

    return { depleted, lowStock };
  }

  /**
   * Release reserved stock when an order is rejected, cancelled, or timed out.
   * Decrements reserved stock:
   * Reserved = Reserved - qty
   * Available = Stock - Reserved (increases back)
   * Restores availability to AVAILABLE if stock was out of stock.
   */
  static async releaseOrderStock(
    sellerId: string | Types.ObjectId,
    items: Array<{ masterProductId: Types.ObjectId | string; quantity: number }>,
  ): Promise<void> {
    const sId = new Types.ObjectId(String(sellerId));

    for (const item of items) {
      const mId = new Types.ObjectId(String(item.masterProductId));
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));

      const updatedListing = await SellerListing.findOneAndUpdate(
        { sellerId: sId, masterProductId: mId },
        { $inc: { reserved: -qty } },
        { new: true },
      );

      if (updatedListing) {
        let dirty = false;
        if (updatedListing.reserved < 0) {
          updatedListing.reserved = 0;
          dirty = true;
        }
        const available = Math.max(0, updatedListing.stock - updatedListing.reserved);
        if (available > 0 && updatedListing.availability === 'OUT_OF_STOCK') {
          updatedListing.availability = 'AVAILABLE';
          dirty = true;
        }
        if (dirty) await updatedListing.save();

        await ShopInventory.findOneAndUpdate(
          { sellerId: sId, masterProductId: mId },
          {
            $set: {
              stock: updatedListing.stock,
              reserved: updatedListing.reserved,
            },
          },
          { upsert: true },
        );

        emitInventoryUpdated(String(sId), {
          masterProductId: String(mId),
          listingId: String(updatedListing._id),
          stock: updatedListing.stock,
          reserved: updatedListing.reserved,
          available: Math.max(0, updatedListing.stock - updatedListing.reserved),
        });
      }
    }
  }

  /**
   * Set / adjust physical stock for a seller listing (e.g. restock or audit).
   * Changing Shop A's stock never changes Shop B's stock.
   * If new available > 0, marks AVAILABLE.
   * If new available <= 0, marks OUT_OF_STOCK.
   */
  static async setStock(
    sellerId: string | Types.ObjectId,
    listingId: string | Types.ObjectId,
    newStock: number,
  ): Promise<ISellerListing> {
    const sId = new Types.ObjectId(String(sellerId));
    const lId = new Types.ObjectId(String(listingId));

    const listing = await SellerListing.findOne({ _id: lId, sellerId: sId });
    if (!listing) throw new AppError('Listing not found in your store', 404);

    const stock = Math.max(0, Math.round(Number(newStock) || 0));
    listing.stock = stock;

    const available = Math.max(0, listing.stock - (listing.reserved || 0));
    if (available <= 0) {
      listing.availability = 'OUT_OF_STOCK';
    } else if (listing.availability === 'OUT_OF_STOCK') {
      listing.availability = 'AVAILABLE';
    }

    await listing.save();

    await ShopInventory.findOneAndUpdate(
      { sellerId: sId, listingId: lId },
      {
        sellerId: sId,
        listingId: lId,
        masterProductId: listing.masterProductId,
        stock: listing.stock,
        reserved: listing.reserved || 0,
      },
      { upsert: true, new: true },
    );

    emitInventoryUpdated(String(sId), {
      masterProductId: String(listing.masterProductId),
      listingId: String(listing._id),
      stock: listing.stock,
      reserved: listing.reserved || 0,
      available: Math.max(0, listing.stock - (listing.reserved || 0)),
    });

    return listing;
  }

  /**
   * Rollback in-flight reservations if any subsequent line in the same cart fails reservation.
   */
  private static async rollbackReservations(
    sellerId: Types.ObjectId,
    items: Array<{ masterProductId: Types.ObjectId; quantity: number }>,
  ): Promise<void> {
    for (const item of items) {
      try {
        const reverted = await SellerListing.findOneAndUpdate(
          { sellerId, masterProductId: item.masterProductId },
          { $inc: { reserved: -item.quantity } },
          { new: true },
        );
        await ShopInventory.updateOne(
          { sellerId, masterProductId: item.masterProductId },
          { $inc: { reserved: -item.quantity } },
        );
        if (reverted) {
          emitInventoryUpdated(String(sellerId), {
            masterProductId: String(item.masterProductId),
            listingId: String(reverted._id),
            stock: reverted.stock,
            reserved: reverted.reserved,
            available: Math.max(0, reverted.stock - reverted.reserved),
          });
        }
      } catch (e) {
        logger.error('Failed to rollback reservation item', { err: e, item });
      }
    }
  }
}

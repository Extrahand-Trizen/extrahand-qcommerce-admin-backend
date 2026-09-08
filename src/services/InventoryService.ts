import { Types } from 'mongoose';
import SellerListing, { ISellerListing } from '../models/SellerListing';
import ShopInventory, { IShopInventory } from '../models/ShopInventory';
import { AppError } from '../utils/response';
import logger from '../config/logger';

export interface StockInfo {
  stock: number;
  reserved: number;
  available: number;
}

export class InventoryService {
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
  ): Promise<{ depleted: Array<{ masterProductId: string; listingId: string }> }> {
    const sId = new Types.ObjectId(String(sellerId));
    const depleted: Array<{ masterProductId: string; listingId: string }> = [];

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
        if (rawStockAfter <= 0 && rawStockAfter + qty > 0) {
          depleted.push({ masterProductId: String(mId), listingId: String(updatedListing._id) });
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
      }
    }

    return { depleted };
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
        await SellerListing.updateOne(
          { sellerId, masterProductId: item.masterProductId },
          { $inc: { reserved: -item.quantity } },
        );
        await ShopInventory.updateOne(
          { sellerId, masterProductId: item.masterProductId },
          { $inc: { reserved: -item.quantity } },
        );
      } catch (e) {
        logger.error('Failed to rollback reservation item', { err: e, item });
      }
    }
  }
}

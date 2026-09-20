import { Types } from 'mongoose';
import CartReservation, { ICartReservation } from '../models/CartReservation';
import SellerListing from '../models/SellerListing';
import ShopInventory from '../models/ShopInventory';
import { InventoryService, StockInfo } from './InventoryService';
import { emitInventoryUpdated } from '../socket/orderSocket';
import { AppError } from '../utils/response';
import logger from '../config/logger';

export const CART_RESERVATION_TTL_MINUTES = 10;

export class CartReservationService {
  /**
   * Reserve or adjust a temporary stock hold for a customer's cart item.
   * Atomically checks available stock (stock - reserved >= delta) and holds it.
   */
  static async reserveCartItem(
    userId: string,
    sellerId: string | Types.ObjectId,
    masterProductId: string | Types.ObjectId,
    productSlug: string,
    requestedQuantity: number,
    ttlMinutes: number = CART_RESERVATION_TTL_MINUTES,
  ): Promise<ICartReservation> {
    const sId = new Types.ObjectId(String(sellerId));
    const mId = new Types.ObjectId(String(masterProductId));
    const targetQty = Math.max(1, Math.floor(Number(requestedQuantity) || 1));

    // Lazy sweep expired reservations for this user and product first
    await this.expireStaleReservations({ userId, sellerId: sId });

    const activeRes = await CartReservation.findOne({
      userId,
      masterProductId: mId,
      status: 'ACTIVE',
      expiresAt: { $gt: new Date() },
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);

    if (activeRes) {
      const currentQty = activeRes.quantity;
      const delta = targetQty - currentQty;

      if (delta === 0) {
        // Just refresh the TTL
        activeRes.expiresAt = expiresAt;
        await activeRes.save();
        return activeRes;
      }

      if (delta > 0) {
        // Need to reserve more
        const updatedListing = await SellerListing.findOneAndUpdate(
          {
            sellerId: sId,
            masterProductId: mId,
            status: 'ACTIVE',
            $expr: { $gte: [{ $subtract: ['$stock', '$reserved'] }, delta] },
          },
          { $inc: { reserved: delta } },
          { new: true },
        );

        if (!updatedListing) {
          const info = await InventoryService.getAvailableStock(sId, mId);
          const totalAvailableForUser = info.available + currentQty;
          throw new AppError(
            `Cannot add ${targetQty} units of "${productSlug}". Only ${totalAvailableForUser} available in this shop.`,
            409,
          );
        }

        await ShopInventory.findOneAndUpdate(
          { sellerId: sId, masterProductId: mId },
          { $inc: { reserved: delta } },
        );

        const available = Math.max(0, updatedListing.stock - updatedListing.reserved);
        if (available <= 0 && updatedListing.availability !== 'OUT_OF_STOCK') {
          updatedListing.availability = 'OUT_OF_STOCK';
          await updatedListing.save();
        }

        activeRes.quantity = targetQty;
        activeRes.expiresAt = expiresAt;
        activeRes.reservedAt = now;
        await activeRes.save();

        emitInventoryUpdated(String(sId), {
          masterProductId: String(mId),
          listingId: String(updatedListing._id),
          stock: updatedListing.stock,
          reserved: updatedListing.reserved,
          available,
        });

        return activeRes;
      } else {
        // delta < 0: releasing some units
        const releaseQty = Math.abs(delta);
        const updatedListing = await SellerListing.findOneAndUpdate(
          { sellerId: sId, masterProductId: mId },
          { $inc: { reserved: -releaseQty } },
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
            { $set: { reserved: updatedListing.reserved } },
          );

          emitInventoryUpdated(String(sId), {
            masterProductId: String(mId),
            listingId: String(updatedListing._id),
            stock: updatedListing.stock,
            reserved: updatedListing.reserved,
            available,
          });
        }

        activeRes.quantity = targetQty;
        activeRes.expiresAt = expiresAt;
        await activeRes.save();

        return activeRes;
      }
    }

    // No existing active reservation: atomically claim targetQty
    const updatedListing = await SellerListing.findOneAndUpdate(
      {
        sellerId: sId,
        masterProductId: mId,
        status: 'ACTIVE',
        $expr: { $gte: [{ $subtract: ['$stock', '$reserved'] }, targetQty] },
      },
      { $inc: { reserved: targetQty } },
      { new: true },
    );

    if (!updatedListing) {
      const info = await InventoryService.getAvailableStock(sId, mId);
      throw new AppError(
        `Cannot add ${targetQty} units of "${productSlug}". Only ${info.available} available in this shop.`,
        409,
      );
    }

    await ShopInventory.findOneAndUpdate(
      { sellerId: sId, masterProductId: mId },
      {
        $setOnInsert: {
          sellerId: sId,
          listingId: updatedListing._id,
          masterProductId: mId,
          stock: updatedListing.stock,
        },
        $inc: { reserved: targetQty },
      },
      { upsert: true, new: true },
    );

    const available = Math.max(0, updatedListing.stock - updatedListing.reserved);
    if (available <= 0 && updatedListing.availability !== 'OUT_OF_STOCK') {
      updatedListing.availability = 'OUT_OF_STOCK';
      await updatedListing.save();
    }

    const reservation = await CartReservation.create({
      userId,
      sellerId: sId,
      masterProductId: mId,
      listingId: updatedListing._id,
      productSlug,
      quantity: targetQty,
      reservedAt: now,
      expiresAt,
      status: 'ACTIVE',
    });

    emitInventoryUpdated(String(sId), {
      masterProductId: String(mId),
      listingId: String(updatedListing._id),
      stock: updatedListing.stock,
      reserved: updatedListing.reserved,
      available,
    });

    return reservation;
  }

  /**
   * Release a cart reservation when an item is removed from the cart.
   */
  static async releaseCartItem(userId: string, productSlug: string): Promise<void> {
    const slug = productSlug.trim();
    const activeRes = await CartReservation.findOne({
      userId,
      productSlug: slug,
      status: 'ACTIVE',
    });

    if (!activeRes) return;

    activeRes.status = 'RELEASED';
    await activeRes.save();

    const updatedListing = await SellerListing.findOneAndUpdate(
      { sellerId: activeRes.sellerId, masterProductId: activeRes.masterProductId },
      { $inc: { reserved: -activeRes.quantity } },
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
        { sellerId: activeRes.sellerId, masterProductId: activeRes.masterProductId },
        { $set: { reserved: updatedListing.reserved } },
      );

      emitInventoryUpdated(String(activeRes.sellerId), {
        masterProductId: String(activeRes.masterProductId),
        listingId: String(updatedListing._id),
        stock: updatedListing.stock,
        reserved: updatedListing.reserved,
        available,
      });
    }
  }

  /**
   * Release all active cart reservations for a customer (e.g. cart cleared).
   */
  static async releaseCart(userId: string): Promise<void> {
    const activeReservations = await CartReservation.find({
      userId,
      status: 'ACTIVE',
    });

    for (const res of activeReservations) {
      res.status = 'RELEASED';
      await res.save();

      const updatedListing = await SellerListing.findOneAndUpdate(
        { sellerId: res.sellerId, masterProductId: res.masterProductId },
        { $inc: { reserved: -res.quantity } },
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
          { sellerId: res.sellerId, masterProductId: res.masterProductId },
          { $set: { reserved: updatedListing.reserved } },
        );

        emitInventoryUpdated(String(res.sellerId), {
          masterProductId: String(res.masterProductId),
          listingId: String(updatedListing._id),
          stock: updatedListing.stock,
          reserved: updatedListing.reserved,
          available,
        });
      }
    }
  }

  /**
   * Expire stale active reservations whose TTL has passed.
   * Decrements SellerListing and ShopInventory reserved quantity,
   * restoring available stock for other customers.
   * NOTE: Does NOT modify CustomerCart.
   */
  static async expireStaleReservations(
    filter: { userId?: string; sellerId?: Types.ObjectId | string } = {},
  ): Promise<number> {
    const now = new Date();
    const query: Record<string, unknown> = {
      status: 'ACTIVE',
      expiresAt: { $lte: now },
    };
    if (filter.userId) query.userId = filter.userId;
    if (filter.sellerId) query.sellerId = new Types.ObjectId(String(filter.sellerId));

    const stale = await CartReservation.find(query);
    let expiredCount = 0;

    for (const doc of stale) {
      // Atomic status transition to prevent race conditions
      const updated = await CartReservation.findOneAndUpdate(
        { _id: doc._id, status: 'ACTIVE' },
        { status: 'EXPIRED' },
        { new: true },
      );

      if (!updated) continue;
      expiredCount++;

      const updatedListing = await SellerListing.findOneAndUpdate(
        { sellerId: doc.sellerId, masterProductId: doc.masterProductId },
        { $inc: { reserved: -doc.quantity } },
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
          { sellerId: doc.sellerId, masterProductId: doc.masterProductId },
          { $set: { reserved: updatedListing.reserved } },
        );

        emitInventoryUpdated(String(doc.sellerId), {
          masterProductId: String(doc.masterProductId),
          listingId: String(updatedListing._id),
          stock: updatedListing.stock,
          reserved: updatedListing.reserved,
          available,
        });
      }
    }

    if (expiredCount > 0) {
      logger.info(`Cart reservations expired: ${expiredCount} hold(s) released`);
    }

    return expiredCount;
  }

  /**
   * At checkout: convert active cart reservations into order reservations,
   * or re-validate and claim stock for items whose reservations expired or never existed.
   * This guarantees:
   * 1. No double counting of reserved units if active reservation exists.
   * 2. Strict real-time re-validation of stock if reservation expired.
   * 3. Atomic reservation and rollback on failure.
   */
  static async consumeOrReserveForOrder(
    userId: string,
    sellerId: Types.ObjectId | string,
    items: Array<{ masterProductId: Types.ObjectId | string; quantity: number; name?: string; productSlug?: string }>,
  ): Promise<void> {
    const sId = new Types.ObjectId(String(sellerId));

    // Expire any stale holds for this customer first
    await this.expireStaleReservations({ userId, sellerId: sId });

    // Track state to rollback if any item fails
    const newlyReserved: Array<{ masterProductId: Types.ObjectId; quantity: number }> = [];
    const consumedReservations: Array<ICartReservation> = [];

    for (const item of items) {
      const mId = new Types.ObjectId(String(item.masterProductId));
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));

      const activeRes = await CartReservation.findOne({
        userId,
        masterProductId: mId,
        status: 'ACTIVE',
        expiresAt: { $gt: new Date() },
      });

      if (activeRes) {
        if (activeRes.quantity >= qty) {
          // Entire order line is already covered by the active cart reservation!
          activeRes.status = 'CONSUMED';
          await activeRes.save();
          consumedReservations.push(activeRes);

          // If reservation had excess quantity, release the excess
          const excess = activeRes.quantity - qty;
          if (excess > 0) {
            const updatedListing = await SellerListing.findOneAndUpdate(
              { sellerId: sId, masterProductId: mId },
              { $inc: { reserved: -excess } },
              { new: true },
            );
            if (updatedListing) {
              await ShopInventory.findOneAndUpdate(
                { sellerId: sId, masterProductId: mId },
                { $set: { reserved: updatedListing.reserved } },
              );
            }
          }
          // Reserved units stay in SellerListing.reserved — seamlessly transferred to order!
          continue;
        } else {
          // Partially covered by active reservation: need delta additional units
          const delta = qty - activeRes.quantity;
          const updatedListing = await SellerListing.findOneAndUpdate(
            {
              sellerId: sId,
              masterProductId: mId,
              status: 'ACTIVE',
              $expr: { $gte: [{ $subtract: ['$stock', '$reserved'] }, delta] },
            },
            { $inc: { reserved: delta } },
            { new: true },
          );

          if (!updatedListing) {
            // Rollback
            await this.rollbackOrderReservation(sId, newlyReserved, consumedReservations);
            const current = await InventoryService.getAvailableStock(sId, mId);
            throw new AppError(
              `Cannot order ${qty} of "${item.name || item.productSlug || 'product'}". Only ${current.available + activeRes.quantity} available in this shop. Please update your cart.`,
              409,
            );
          }

          await ShopInventory.findOneAndUpdate(
            { sellerId: sId, masterProductId: mId },
            { $inc: { reserved: delta } },
          );

          activeRes.status = 'CONSUMED';
          await activeRes.save();
          consumedReservations.push(activeRes);
          newlyReserved.push({ masterProductId: mId, quantity: delta });
          continue;
        }
      }

      // No active reservation (reservation expired or not made): revalidate latest stock
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
        // Rollback
        await this.rollbackOrderReservation(sId, newlyReserved, consumedReservations);
        const current = await InventoryService.getAvailableStock(sId, mId);
        throw new AppError(
          `Cannot order ${qty} of "${item.name || item.productSlug || 'product'}". Only ${current.available} available in this shop. Please update your cart.`,
          409,
        );
      }

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

      const available = Math.max(0, updatedListing.stock - updatedListing.reserved);
      if (available <= 0 && updatedListing.availability !== 'OUT_OF_STOCK') {
        updatedListing.availability = 'OUT_OF_STOCK';
        await updatedListing.save();
      }

      newlyReserved.push({ masterProductId: mId, quantity: qty });
    }
  }

  private static async rollbackOrderReservation(
    sellerId: Types.ObjectId,
    newlyReserved: Array<{ masterProductId: Types.ObjectId; quantity: number }>,
    consumedReservations: Array<ICartReservation>,
  ): Promise<void> {
    for (const item of newlyReserved) {
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
        logger.error('Failed to rollback newly reserved order stock', { err: e });
      }
    }

    for (const res of consumedReservations) {
      try {
        res.status = 'ACTIVE';
        await res.save();
      } catch (e) {
        logger.error('Failed to restore consumed cart reservation', { err: e });
      }
    }
  }
}

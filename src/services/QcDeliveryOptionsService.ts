import { Types } from 'mongoose';
import QcDeliverySlot, { IQcDeliverySlot } from '../models/QcDeliverySlot';
import SellerStoreSettings, { ISellerStoreSettings } from '../models/SellerStoreSettings';
import { StorefrontService, type StorefrontQuery } from './StorefrontService';
import { scheduledDeliveryConfig as cfg } from '../config/scheduledDelivery';
import { AppError } from '../utils/response';
import type { Weekday } from '../types';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WEEKDAY_BY_INDEX: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const QC_DELIVERY_TYPE = ['EXPRESS', 'SCHEDULED'] as const;
export type QcDeliveryType = (typeof QC_DELIVERY_TYPE)[number];

function toIstParts(date: Date) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    day: ist.getUTCDate(),
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes(),
    weekday: WEEKDAY_BY_INDEX[ist.getUTCDay()],
  };
}

function istDateKey(parts: { year: number; month: number; day: number }): string {
  const m = String(parts.month + 1).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${parts.year}-${m}-${d}`;
}

/** Build a UTC Date that represents HH:mm on an IST calendar day. */
function istWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
): Date {
  return new Date(Date.UTC(year, month, day, hours, minutes, 0, 0) - IST_OFFSET_MS);
}

function parseHm(value: string): { h: number; m: number } {
  const [h, m] = String(value || '09:00')
    .split(':')
    .map((n) => Number(n));
  return {
    h: Number.isFinite(h) ? h : 9,
    m: Number.isFinite(m) ? m : 0,
  };
}

function slotGroupForHour(hour: number): { groupKey: string; groupLabel: string } {
  if (hour < 12) return { groupKey: 'morning', groupLabel: 'Morning' };
  if (hour < 17) return { groupKey: 'afternoon', groupLabel: 'Afternoon' };
  return { groupKey: 'evening', groupLabel: 'Evening' };
}

function formatSlotLabel(startAt: Date, endAt: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });
  return `${fmt(startAt)} – ${fmt(endAt)}`;
}

function formatDateLabel(dateKey: string, todayKey: string, tomorrowKey: string): string {
  if (dateKey === todayKey) return 'Today';
  if (dateKey === tomorrowKey) return 'Tomorrow';
  const [y, m, d] = dateKey.split('-').map(Number);
  const utcApprox = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return utcApprox.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

function estimateExpressEtaMinutes(distanceKm?: number | null): number | null {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km < 0) return null;
  const rideMins = Math.max(
    1,
    Math.ceil((km / cfg.EXPRESS_AVERAGE_SPEED_KMH) * 60),
  );
  return cfg.EXPRESS_PREP_BUFFER_MINUTES + rideMins;
}

function remainingCapacity(slot: Pick<IQcDeliverySlot, 'capacity' | 'heldCount' | 'bookedCount'>) {
  return Math.max(0, slot.capacity - slot.heldCount - slot.bookedCount);
}

function isSlotBookable(
  slot: Pick<IQcDeliverySlot, 'status' | 'capacity' | 'heldCount' | 'bookedCount' | 'startAt'>,
  now = new Date(),
): boolean {
  if (slot.status !== 'OPEN') return false;
  if (remainingCapacity(slot) <= 0) return false;
  const cutoff = new Date(now.getTime() + cfg.SCHEDULED_BOOKING_CUTOFF_MINUTES * 60_000);
  return slot.startAt.getTime() > cutoff.getTime();
}

async function loadStoreSettings(sellerId: Types.ObjectId): Promise<ISellerStoreSettings> {
  const existing = await SellerStoreSettings.findOne({ sellerId });
  if (existing) return existing;
  return SellerStoreSettings.create({ sellerId });
}

/**
 * Ensure slot documents exist for the seller over the configured horizon,
 * using store open/close hours and daysOpen.
 */
export async function ensureSlotsForSeller(
  sellerId: Types.ObjectId,
  settings: ISellerStoreSettings,
): Promise<void> {
  const now = new Date();
  const todayParts = toIstParts(now);
  const open = parseHm(settings.openTime);
  const close = parseHm(settings.closeTime);
  const openMinutes = open.h * 60 + open.m;
  let closeMinutes = close.h * 60 + close.m;
  // Same-day windows only for v1 (no overnight wrap for slot generation).
  if (closeMinutes <= openMinutes) {
    closeMinutes = openMinutes + 8 * 60;
  }

  const duration = cfg.SCHEDULED_SLOT_DURATION_MINUTES;
  const ops: Array<{
    updateOne: {
      filter: { sellerId: Types.ObjectId; startAt: Date; endAt: Date };
      update: { $setOnInsert: Record<string, unknown> };
      upsert: true;
    };
  }> = [];

  for (let offset = 0; offset < cfg.SCHEDULED_HORIZON_DAYS; offset += 1) {
    const dayUtc = new Date(
      Date.UTC(todayParts.year, todayParts.month, todayParts.day + offset, 12, 0, 0),
    );
    const dayParts = toIstParts(dayUtc);
    const weekday = dayParts.weekday;
    if (!settings.daysOpen.includes(weekday)) continue;

    const dateKey = istDateKey(dayParts);
    for (let minute = openMinutes; minute + duration <= closeMinutes; minute += duration) {
      const startH = Math.floor(minute / 60);
      const startM = minute % 60;
      const endMinute = minute + duration;
      const endH = Math.floor(endMinute / 60);
      const endM = endMinute % 60;
      const startAt = istWallTimeToUtc(
        dayParts.year,
        dayParts.month,
        dayParts.day,
        startH,
        startM,
      );
      const endAt = istWallTimeToUtc(dayParts.year, dayParts.month, dayParts.day, endH, endM);
      const group = slotGroupForHour(startH);
      ops.push({
        updateOne: {
          filter: { sellerId, startAt, endAt },
          update: {
            $setOnInsert: {
              sellerId,
              dateKey,
              startAt,
              endAt,
              capacity: cfg.SCHEDULED_DEFAULT_CAPACITY,
              heldCount: 0,
              bookedCount: 0,
              status: 'OPEN',
              groupKey: group.groupKey,
              groupLabel: group.groupLabel,
            },
          },
          upsert: true,
        },
      });
    }
  }

  if (ops.length > 0) {
    await QcDeliverySlot.bulkWrite(ops, { ordered: false }).catch(() => undefined);
  }
}

export type DeliveryOptionsResult = {
  sellerId: string | null;
  serviceable: boolean;
  cancelCutoffMinutes: number;
  express: {
    available: boolean;
    etaMinutes: number | null;
    unavailableReason: string | null;
  };
  scheduled: {
    available: boolean;
    unavailableReason: string | null;
    dates: Array<{
      date: string;
      label: string;
      groups: Array<{
        id: string;
        label: string;
        slots: Array<{
          slotId: string;
          startAt: string;
          endAt: string;
          label: string;
          available: boolean;
        }>;
      }>;
    }>;
  };
};

export class QcDeliveryOptionsService {
  static async getOptions(query: StorefrontQuery = {}): Promise<DeliveryOptionsResult> {
    const home = await StorefrontService.getHome(query);
    const sellerId = home.store?.sellerId ? String(home.store.sellerId) : null;
    const serviceable = Boolean(home.serviceable && sellerId);
    const cancelCutoffMinutes = cfg.SCHEDULED_CANCEL_CUTOFF_MINUTES;

    const emptyScheduled = {
      available: false,
      unavailableReason: serviceable
        ? 'No scheduled slots available right now'
        : 'Delivery is not available at your location',
      dates: [] as DeliveryOptionsResult['scheduled']['dates'],
    };

    if (!serviceable || !sellerId || !Types.ObjectId.isValid(sellerId)) {
      return {
        sellerId: null,
        serviceable: false,
        cancelCutoffMinutes,
        express: {
          available: false,
          etaMinutes: null,
          unavailableReason: 'Delivery is not available at your location',
        },
        scheduled: emptyScheduled,
      };
    }

    const sellerObjectId = new Types.ObjectId(sellerId);
    const settings = await loadStoreSettings(sellerObjectId);
    const closed = settings.storeStatus === 'CLOSED';
    const paused = Boolean(settings.autoPausedAt);
    const acceptingOrders = Boolean(home.store?.acceptingOrders) && !closed && !paused;

    const expressEta = estimateExpressEtaMinutes(home.store?.distanceKm);
    const express = {
      available: acceptingOrders,
      etaMinutes: acceptingOrders ? expressEta : null,
      unavailableReason: acceptingOrders
        ? null
        : closed
          ? 'This shop is currently closed'
          : paused
            ? 'Express is currently unavailable due to high demand'
            : 'Express delivery is currently unavailable',
    };

    // Scheduled: allowed when serviceable and not hard-closed (pause = express-only block).
    if (closed) {
      return {
        sellerId,
        serviceable: true,
        cancelCutoffMinutes,
        express,
        scheduled: {
          available: false,
          unavailableReason: 'This shop is currently closed',
          dates: [],
        },
      };
    }

    await ensureSlotsForSeller(sellerObjectId, settings);

    const horizonEnd = new Date(
      Date.now() + cfg.SCHEDULED_HORIZON_DAYS * 24 * 60 * 60 * 1000,
    );
    const slots = await QcDeliverySlot.find({
      sellerId: sellerObjectId,
      status: 'OPEN',
      startAt: { $gte: new Date(), $lte: horizonEnd },
    })
      .sort({ startAt: 1 })
      .lean();

    const now = new Date();
    const todayKey = istDateKey(toIstParts(now));
    const tomorrowParts = toIstParts(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const tomorrowKey = istDateKey(tomorrowParts);

    const byDate = new Map<
      string,
      Map<string, { id: string; label: string; slots: DeliveryOptionsResult['scheduled']['dates'][0]['groups'][0]['slots'] }>
    >();

    for (const slot of slots) {
      if (!isSlotBookable(slot, now)) continue;
      const dateKey = slot.dateKey;
      if (!byDate.has(dateKey)) byDate.set(dateKey, new Map());
      const groups = byDate.get(dateKey)!;
      if (!groups.has(slot.groupKey)) {
        groups.set(slot.groupKey, {
          id: slot.groupKey,
          label: slot.groupLabel,
          slots: [],
        });
      }
      groups.get(slot.groupKey)!.slots.push({
        slotId: String(slot._id),
        startAt: new Date(slot.startAt).toISOString(),
        endAt: new Date(slot.endAt).toISOString(),
        label: formatSlotLabel(new Date(slot.startAt), new Date(slot.endAt)),
        available: true,
      });
    }

    const dates: DeliveryOptionsResult['scheduled']['dates'] = [];
    for (const [date, groups] of byDate) {
      const groupList = Array.from(groups.values()).filter((g) => g.slots.length > 0);
      if (groupList.length === 0) continue;
      dates.push({
        date,
        label: formatDateLabel(date, todayKey, tomorrowKey),
        groups: groupList,
      });
    }

    const scheduledAvailable = dates.length > 0;
    return {
      sellerId,
      serviceable: true,
      cancelCutoffMinutes,
      express,
      scheduled: {
        available: scheduledAvailable,
        unavailableReason: scheduledAvailable
          ? null
          : 'No scheduled slots available right now',
        dates,
      },
    };
  }

  /** Atomically hold capacity for unpaid checkout. */
  static async holdSlot(input: {
    slotId: string;
    sellerId: Types.ObjectId | string;
  }): Promise<IQcDeliverySlot> {
    if (!Types.ObjectId.isValid(input.slotId)) {
      throw new AppError('Invalid delivery slot', 400, undefined, 'SCHEDULE_SLOT_UNAVAILABLE');
    }
    const sellerId = new Types.ObjectId(String(input.sellerId));
    const cutoff = new Date(Date.now() + cfg.SCHEDULED_BOOKING_CUTOFF_MINUTES * 60_000);
    const updated = await QcDeliverySlot.findOneAndUpdate(
      {
        _id: new Types.ObjectId(input.slotId),
        sellerId,
        status: 'OPEN',
        startAt: { $gt: cutoff },
        $expr: { $lt: [{ $add: ['$heldCount', '$bookedCount'] }, '$capacity'] },
      },
      { $inc: { heldCount: 1 } },
      { new: true },
    );
    if (!updated) {
      throw new AppError(
        'This delivery slot is no longer available. Please choose another time.',
        409,
        undefined,
        'SCHEDULE_SLOT_UNAVAILABLE',
      );
    }
    return updated;
  }

  static async releaseHold(slotId: string | Types.ObjectId | null | undefined): Promise<void> {
    if (!slotId || !Types.ObjectId.isValid(String(slotId))) return;
    await QcDeliverySlot.updateOne(
      { _id: new Types.ObjectId(String(slotId)), heldCount: { $gt: 0 } },
      { $inc: { heldCount: -1 } },
    );
  }

  /** Convert hold → booked after successful payment. */
  static async confirmHold(slotId: string | Types.ObjectId | null | undefined): Promise<void> {
    if (!slotId || !Types.ObjectId.isValid(String(slotId))) return;
    await QcDeliverySlot.updateOne(
      { _id: new Types.ObjectId(String(slotId)), heldCount: { $gt: 0 } },
      { $inc: { heldCount: -1, bookedCount: 1 } },
    );
  }

  static async releaseBooked(slotId: string | Types.ObjectId | null | undefined): Promise<void> {
    if (!slotId || !Types.ObjectId.isValid(String(slotId))) return;
    await QcDeliverySlot.updateOne(
      { _id: new Types.ObjectId(String(slotId)), bookedCount: { $gt: 0 } },
      { $inc: { bookedCount: -1 } },
    );
  }

  static getCancelCutoffMinutes(): number {
    return cfg.SCHEDULED_CANCEL_CUTOFF_MINUTES;
  }

  static getActivationLeadMinutes(): number {
    return cfg.SCHEDULED_ACTIVATION_LEAD_MINUTES;
  }
}

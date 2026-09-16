/**
 * Scheduled delivery tuning for Quick Commerce.
 * Values come from env so mobile never hardcodes cutoffs or slot length.
 */
import { z } from 'zod';

const schema = z.object({
  /** Length of each generated delivery window. */
  SCHEDULED_SLOT_DURATION_MINUTES: z.coerce.number().int().positive().default(60),
  /** How many calendar days ahead (including today) to offer. */
  SCHEDULED_HORIZON_DAYS: z.coerce.number().int().positive().default(3),
  /** Default max paid+held orders per slot. */
  SCHEDULED_DEFAULT_CAPACITY: z.coerce.number().int().positive().default(20),
  /** Customer cannot book a slot starting sooner than this. */
  SCHEDULED_BOOKING_CUTOFF_MINUTES: z.coerce.number().int().nonnegative().default(60),
  /** Activate SCHEDULED → PENDING_ACCEPT this many minutes before window start. */
  SCHEDULED_ACTIVATION_LEAD_MINUTES: z.coerce.number().int().nonnegative().default(45),
  /** Customer cancel blocked inside this lead before scheduled start. */
  SCHEDULED_CANCEL_CUTOFF_MINUTES: z.coerce.number().int().nonnegative().default(30),
  /** Prep + ride estimate inputs (mirror cart client formula). */
  EXPRESS_PREP_BUFFER_MINUTES: z.coerce.number().int().nonnegative().default(10),
  EXPRESS_AVERAGE_SPEED_KMH: z.coerce.number().positive().default(15),
});

export const scheduledDeliveryConfig = schema.parse({
  SCHEDULED_SLOT_DURATION_MINUTES: process.env.SCHEDULED_SLOT_DURATION_MINUTES,
  SCHEDULED_HORIZON_DAYS: process.env.SCHEDULED_HORIZON_DAYS,
  SCHEDULED_DEFAULT_CAPACITY: process.env.SCHEDULED_DEFAULT_CAPACITY,
  SCHEDULED_BOOKING_CUTOFF_MINUTES: process.env.SCHEDULED_BOOKING_CUTOFF_MINUTES,
  SCHEDULED_ACTIVATION_LEAD_MINUTES: process.env.SCHEDULED_ACTIVATION_LEAD_MINUTES,
  SCHEDULED_CANCEL_CUTOFF_MINUTES: process.env.SCHEDULED_CANCEL_CUTOFF_MINUTES,
  EXPRESS_PREP_BUFFER_MINUTES: process.env.EXPRESS_PREP_BUFFER_MINUTES,
  EXPRESS_AVERAGE_SPEED_KMH: process.env.EXPRESS_AVERAGE_SPEED_KMH,
});

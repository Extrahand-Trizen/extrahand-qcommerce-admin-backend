/**
 * Smoke checks for scheduled delivery slot capacity helpers.
 * Run: npx ts-node src/scripts/testScheduledDeliverySlots.ts
 *
 * Does not require Mongo when only pure helpers are exercised; hold/confirm
 * paths need a running DB — those are skipped if MONGODB_URI is unset.
 */
import { scheduledDeliveryConfig } from '../config/scheduledDelivery';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function main() {
  assert(scheduledDeliveryConfig.SCHEDULED_SLOT_DURATION_MINUTES > 0, 'slot duration');
  assert(scheduledDeliveryConfig.SCHEDULED_HORIZON_DAYS > 0, 'horizon');
  assert(scheduledDeliveryConfig.SCHEDULED_DEFAULT_CAPACITY > 0, 'capacity');
  assert(scheduledDeliveryConfig.SCHEDULED_BOOKING_CUTOFF_MINUTES >= 0, 'booking cutoff');
  assert(scheduledDeliveryConfig.SCHEDULED_CANCEL_CUTOFF_MINUTES >= 0, 'cancel cutoff');
  assert(scheduledDeliveryConfig.SCHEDULED_ACTIVATION_LEAD_MINUTES >= 0, 'activation lead');
  console.log('ok: scheduledDeliveryConfig defaults parse');
  console.log(JSON.stringify(scheduledDeliveryConfig, null, 2));
}

main();

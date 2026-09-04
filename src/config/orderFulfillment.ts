/**
 * Track B — accept-countdown / auto-reject tuning.
 *
 * A paid order sits in PENDING_ACCEPT until the shopkeeper accepts or rejects it.
 * If neither happens within ACCEPT_WINDOW_SECONDS the backend auto-rejects it,
 * refunds the customer in full, and counts it as a rejection against the shop.
 *
 * Rejections + accept-timeouts accumulate into a per-calendar-day "rejection
 * cycle": REJECTION_CYCLE_THRESHOLD of them pauses NEW orders for
 * PAUSE_DURATION_MINUTES, after which the shop reopens itself and the cycle
 * counter resets to 0 (the next batch is a fresh cycle). Everything resets at
 * IST midnight. See SellerFulfillmentHealthService.
 */

/** How long the shopkeeper has to accept/reject a new order. */
export const ACCEPT_WINDOW_SECONDS = 90;

/** Reject/miss this many orders in one cycle → pause NEW orders. */
export const REJECTION_CYCLE_THRESHOLD = 3;

/** How long the shop stays auto-paused before it reopens itself and starts a
 *  fresh rejection cycle. */
export const PAUSE_DURATION_MINUTES = 3;

/** How often the background sweep looks for past-deadline orders + expired pauses. */
export const ACCEPT_TIMEOUT_SWEEP_MS = 30_000;

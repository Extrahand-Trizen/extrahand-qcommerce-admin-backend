# Order Pickup QR — Audit & Implementation Plan

**Status:** IMPLEMENTED 2026-09-09 across all 3 repos (QC backend, `extra-hand-seller`,
`extrahand-mobile-app`). All type-check clean. **Not deployed, not device-tested.**
Remaining: set `PICKUP_QR_SECRET` (dev + prod), run `src/scripts/testPickupQr.ts`
against a real DB, `pod install` + native rebuild of the mobile app, device QA.
Original locked plan below is unchanged.

---

**Status (original):** approved decisions locked (2026-09-09). Not implemented.
**Scope:** replace the seller's 4-digit `handoverCode` handover step with a
seller-shown, partner-scanned **Order Pickup QR**. QR validity is driven purely by
the order/pickup lifecycle — never by a timer.

Repos touched:
- `extrahand-qcommerce-admin-backend` — QR lifecycle, partner auth, verify endpoint (primary)
- `extra-hand-seller` — show the QR on the order screen
- `extrahand-mobile-app` — **new** "Scan Pickup QR" for the delivery partner (needs a camera lib + native rebuild)
- `EH-api-gateway` — no change (the `/api/v1/qc/*` catch-all proxy already covers new routes)

---

## 0. Locked decisions (from review, 2026-09-09)

| # | Decision |
|---|---|
| A | **Scan side is in scope** — the delivery partner (the `partner` role) scans in `extrahand-mobile-app`. |
| B | **Keep the enum values** `READY` and `HANDED_OVER`. No `READY_FOR_PICKUP` / `PICKED_UP`. Relabel to "Ready for Pickup" / "Picked up" in the apps only. No migration, no settlement/metrics/DTO churn. |
| C | **QR only — no fallback.** Remove `handoverCode` generation and the `mark-handed-over` seller action entirely. `READY → HANDED_OVER` happens **only** via a valid partner scan. |
| D | **No partner↔order assignment exists today.** Use **claim-on-scan**: any authenticated `partner`-role user may scan; on success set `order.partnerId` / `order.partnerUid` to that partner. Forward-compatible with a real dispatch system later. |
| E | **Scanner lib:** `react-native-vision-camera` (v4, `useCodeScanner`). Bump `extrahand-mobile-app` `minSdkVersion` 24 → **26** (drops Android 7.0/7.1). |
| F | **Tests:** follow the repo's ad-hoc pattern — `src/scripts/testPickupQr.ts` scenario runner against a real DB (like `testShopPause.ts`). No jest. |
| G | **Token:** signed JWT (HS256), backend-only secret `PICKUP_QR_SECRET`, claims `{ purpose, orderId, storeId, jti, iat }`, **no `exp`**. QR string = `ORDER_PICKUP:<jwt>`. |

### ⚠️ Risk accepted with decision C + D

With QR-only + claim-on-scan + no expiry, **anyone with the `partner` role who can
see (or photograph) the seller's screen while the order sits in `READY` can
complete the pickup and claim the order.** Mitigations in place: the QR is
single-use (`USED` is terminal), it only exists during the `READY` window, and it
is re-minted (old one `REVOKED`) every time the seller re-marks the order ready.
**Recommendation:** add real dispatch assignment (partner pre-bound to the order,
Step 7 becomes a hard check) before wide rollout. Tracked as a follow-up, not part
of this plan.

---

## 1. Current state (what we're replacing)

- **`handoverCode`** — 4 random digits, generated in `QcOrderService.confirmPayment`
  (`order.handoverCode = generateHandoverCode()`), stored on `CustomerOrder`,
  returned only in the seller DTO (`formatOrder`, `opts.forSeller`).
- **Seller flow:** `mark-ready` → seller app `OrderDetailScreen`
  ([L396-L417](../../../extra-hand-seller/src/features/orders/screens/OrderDetailScreen.tsx)) shows a 4-digit input →
  `POST /api/v1/seller/orders/:id/mark-handed-over { handoverCode }` →
  `OrderFulfillmentService.transition` checks the code → `READY → HANDED_OVER`,
  and `status: PAID → CONFIRMED`.
- **The partner never receives the code** — `extrahand-mobile-app` doesn't call
  the QC backend at all. `partnerId` / `assigneeUid` / `forPartner` DTO exist on
  the schema but are never used. The step is effectively non-functional today.
- State machine (`OrderFulfillmentService.TRANSITIONS`):
  `PENDING_ACCEPT → ACCEPTED → PREPARING → READY → HANDED_OVER` (+ `REJECTED`, `CANCELLED`).

---

## 2. Data model — new collection `OrderPickupQR`

```
_id               ObjectId
jti               string    unique, indexed     e.g. "qr_" + 24 hex
orderId           ObjectId  indexed  (ref CustomerOrder)
sellerId          ObjectId  indexed             ("storeId")
purpose           'ORDER_PICKUP'                (const — future-proofs the collection)
status            'ACTIVE' | 'USED' | 'REVOKED' indexed
token             string    (the signed JWT — stored so GET pickup-qr returns it without re-signing)
createdAt         Date
usedAt            Date?
usedByPartnerId   string?   (partner Firebase uid)
usedByPartnerName string?
revokedAt         Date?
revokedReason     'REPREPARED' | 'ORDER_CANCELLED' | 'STORE_DELETED' | null
events            [{ type:'GENERATED'|'REVOKED'|'SCAN_OK'|'SCAN_FAIL', at:Date, actorType:'seller'|'partner'|'system', actorId?:string, meta?:object }]
```

**Indexes**
- `{ jti: 1 }` **unique**
- `{ orderId: 1, status: 1 }` **partial-unique where `status: 'ACTIVE'`** → the DB
  guarantees at most one live QR per order; the app never has to guard that race.
- `{ sellerId: 1, status: 1 }`
- `{ orderId: 1, createdAt: -1 }`

**Store deletion:** add `OrderPickupQR.deleteMany({ sellerId })` to
`SellerService.purgeStoreCollections` (covers both `deleteOwnStore` and admin
`deleteSeller`).

---

## 3. Backend — `OrderPickupService` (new)

### 3.1 `generateForOrder(order, session?) → { jti, token }`
1. `OrderPickupQR.updateMany({ orderId, status:'ACTIVE' }, { $set:{ status:'REVOKED', revokedAt:now, revokedReason:'REPREPARED' }, $push:{ events:{type:'REVOKED',actorType:'system',...} } })` — clear any stale active QR.
2. `jti = 'qr_' + crypto.randomBytes(12).toString('hex')`.
3. `token = jwt.sign({ purpose:'ORDER_PICKUP', orderId:String(order._id), storeId:String(order.sellerId), jti, iat: nowSeconds }, env.PICKUP_QR_SECRET)` — **no `expiresIn`**.
4. Insert `OrderPickupQR { jti, orderId, sellerId, purpose:'ORDER_PICKUP', status:'ACTIVE', token, createdAt:now, events:[{type:'GENERATED',actorType:'system'}] }`.
5. Return `{ jti, token }`.

### 3.2 Wiring into the order lifecycle (`OrderFulfillmentService`)
- **`mark-ready` success (→ `READY`):** call `generateForOrder(order)` right after `order.save()`.
- **New action `back-to-preparing` (`READY → PREPARING`):** allowed transition; behaves like `start-preparing` (resets the pick checklist, `preparingStartedAt`); **revokes** the `ACTIVE` QR (`REPREPARED`). Spec §6 — an old screenshot is now dead; a fresh `jti` + token is minted on the next `mark-ready`.
- **`CANCELLED`** (customer cancel in `QcOrderService`, and any future timeout-from-READY): revoke the `ACTIVE` QR (`ORDER_CANCELLED`).
- **Remove** the `mark-handed-over` action, its `handoverCode` check, `FulfillmentPayload.handoverCode`, `generateHandoverCode()` + its call in `confirmPayment`, and `handoverCode` from `formatOrder`. (Leave the dead `CustomerOrder.handoverCode` field for now; drop in a later cleanup.)

### 3.3 `verifyAndCompletePickup(partner, rawQr) → result` — the 8 checks

| Step | Check | Failure `code` (HTTP) |
|---|---|---|
| 1 | strip `ORDER_PICKUP:` prefix; `jwt.verify(token, PICKUP_QR_SECRET)` | `INVALID_QR` (400) |
| 2 | `payload.purpose === 'ORDER_PICKUP'` | `INVALID_QR_PURPOSE` (400) |
| 3 | `OrderPickupQR.findOne({ jti })` exists; `CustomerOrder.findById(payload.orderId)` exists | `INVALID_QR` (404) / `ORDER_NOT_FOUND` (404) |
| 4 | `String(qr.sellerId) === String(order.sellerId) === payload.storeId` | `STORE_MISMATCH` (409) |
| 5 | `order.fulfillmentStatus === 'READY'` **and** `order.status ∉ {CANCELLED, FAILED, DELIVERED}` | `ORDER_NOT_READY` (409); `ORDER_CANCELLED` (409) if cancelled |
| 6 | `qr.status === 'ACTIVE'` | `QR_ALREADY_USED` (409) if `USED`; `QR_REVOKED` (409) if `REVOKED` |
| 7 | if `order.partnerUid` set → must equal `partner.uid`; else pass (claim below) | `PICKUP_NOT_AUTHORIZED` (403) |
| 8 | **atomic completion** (see 3.4) | `QR_ALREADY_USED` / `ORDER_NOT_READY` on lost race |

**Success →**
```json
{ "success": true, "message": "Order pickup confirmed",
  "orderId": "...", "storeId": "...", "orderNumber": "12345",
  "shopName": "ABC Store", "status": "HANDED_OVER" }
```
Never includes customer name / phone / address / payment info.

**After commit (best-effort, non-blocking):**
- `notifyCustomerOrderUpdate({ action:'mark-handed-over', ... })` — existing branch → customer push "*Order picked up · on its way*".
- notify the seller: "Order #12345 picked up by <partner>" (`QcOrderNotificationService`, `recipientRole:'seller'`).
- append `SCAN_FAIL` events (with the failure `code`) on rejected attempts for the audit trail.

### 3.4 Atomicity (spec §8)
`session.withTransaction` (Atlas replica set; same pattern as `SellerService.deleteOwnStore`, with a sequential fallback):

```
qr = OrderPickupQR.findOneAndUpdate(
        { jti, status: 'ACTIVE' },
        { $set: { status:'USED', usedAt:now, usedByPartnerId:partner.uid, usedByPartnerName:partner.name },
          $push:{ events:{ type:'SCAN_OK', actorType:'partner', actorId:partner.uid, at:now } } },
        { new:true, session })
if (!qr)  → abort; re-read to classify QR_ALREADY_USED vs QR_REVOKED

order = CustomerOrder.findOneAndUpdate(
        { _id: payload.orderId, sellerId: qr.sellerId,
          fulfillmentStatus: 'READY', status: { $nin:['CANCELLED','FAILED'] } },
        { $set: { fulfillmentStatus:'HANDED_OVER',
                  partnerId: <ObjectId if valid>, partnerUid: partner.uid,
                  partnerAcceptedAt: now,
                  ...(order.status === 'PAID' ? { status:'CONFIRMED' } : {}) },
          $push:{ fulfillmentEvents:{ action:'PICKED_UP', by:'partner', at:now, meta:{ partnerId:partner.uid, jti } } } },
        { new:true, session })
if (!order) → abort (ORDER_NOT_READY)

commit
```
Two partners scanning at the same instant: the `findOneAndUpdate` on the QR
(`status:'ACTIVE'`) is the compare-and-set point — exactly one wins, the other
gets `QR_ALREADY_USED`.

---

## 4. Backend — partner auth

### `verifyPlatformTokenRaw(token)` — add to `utils/jwt.ts`
Returns `{ sub, sid?, pid? }` **without** hard-coding `role:'SELLER'` (the current
`verifyPlatformToken` always asserts seller).

### `authenticatePartner` / `requirePartner` middleware — new, mirrors `authenticateCustomer`
1. Bearer present → try `verifyToken` (QC-admin / platform JWT). If that yields a `sub`, use it.
2. Else (mobile app sends a **Firebase ID token**) → `GET {API_GATEWAY_URL}/api/v1/profiles/me` with the bearer (same fallback `authenticateCustomer` already does) → `{ profile: { uid, name, roles } }`.
3. Assert `roles` (normalized) includes **`partner`** → else `403 PICKUP_NOT_AUTHORIZED`.
4. Attach `req.partner = { uid, name }`. 60 s in-memory cache keyed by token hash to avoid a user-service round-trip per scan.

`requirePartner = [authenticatePartner]` (no store attach).

---

## 5. API surface

### QC backend
| Method + path | Auth | Purpose |
|---|---|---|
| `POST /api/v1/qc/partner/orders/pickup/verify-qr` | `requirePartner` | body `{ qrToken }` → `verifyAndCompletePickup`. **The one endpoint the mobile app calls.** |
| `GET /api/v1/seller/orders/:id/pickup-qr` | `requireSeller` | `{ jti, token, qrString:"ORDER_PICKUP:<token>", status, createdAt }` or `404` |
| `POST /api/v1/seller/orders/:id/back-to-preparing` | `requireSeller` | `READY → PREPARING`, revoke QR (spec §6) |

Also: `formatOrder(..., { forSeller:true })` gains
`pickupQr: { token, jti, status } | null` so `OrderDetailScreen` renders the QR
with no extra call; `GET /seller/orders/:id/pickup-qr` is the explicit refresh.

### Gateway
No change — `router.all('/*', proxyToQc)` already forwards `/api/v1/qc/partner/*`
with the `Authorization` header. `/api/v1/qc` has no gateway-level auth; the QC
backend authenticates.

---

## 6. Seller app (`extra-hand-seller`)

- **Add** `react-native-qrcode-svg` (pure JS on the already-linked `react-native-svg` — **no native rebuild**).
- `data/types/domain.ts` — `Order.pickupQr?: { token:string; jti:string; status:string }`.
- `api/sellerOrders.ts` — map `raw.pickupQr`; add `fetchPickupQr(orderId)`. Drop `markSellerOrderHandedOver`.
- `utils/orderTransitions.ts` — remove `mark_handed_over` from `getOrderActions('ready')` and from `OrderAction`. `ready` now has **no seller action** — it's partner-driven.
- `OrderDetailScreen`, `status === 'ready'` branch — replace the code input with:
  ```
  Ready for Pickup

  Pickup QR
  [  ~260 px QR of  ORDER_PICKUP:<token>  ]
  Show this QR to the delivery partner when they arrive to collect the order.
  ```
  Refetch on focus + a light poll; when `fulfillmentStatus` flips to `handed_over`
  show "Picked up ✓ · <time>" (+ partner name if present).
- `OrderReadyModal.tsx` — swap "Waiting for a delivery partner pickup" copy to
  point at the QR; optionally render a small QR in the modal.
- `useOrderStore` — remove `handOver`; keep `markReady`. Add `backToPreparing` (optional).
- `LogisticsTrackingScreen` / `useDeliveryStore` — unchanged (still stub); no `handoverCode` refs to fix there.

---

## 7. Partner app (`extrahand-mobile-app`)

- **Add** `react-native-vision-camera` (v4). Android: `minSdkVersion` 24 → **26**,
  `<uses-permission android:name="android.permission.CAMERA"/>`, Gradle sync.
  iOS: `NSCameraUsageDescription`. **Native rebuild required.**
- `src/api/qcPickup.ts` — `verifyPickupQr(qrToken)` →
  `POST {gateway}/api/v1/qc/partner/orders/pickup/verify-qr` with the existing
  Firebase-token auth header path (`api.ts`).
- **`ScanPickupQrScreen`:**
  - full-screen camera + reticle; `useCodeScanner({ codeTypes:['qr'] })`.
  - on decode: ignore anything not starting with `ORDER_PICKUP:`; debounce repeat scans ~3 s; freeze the camera on first accept.
  - POST the token → spinner → **success**: "Pickup Confirmed ✓ / Order #12345 / Store: ABC Store / Order successfully picked up." → **failure**: the mapped message (§8) + "Try again".
- **Entry point:** a "Scan Pickup QR" action on the partner's home / active-jobs
  area. Because there's no assignment yet (decision D), this is a standalone
  scanner the partner opens on arrival at the store — no order pre-selected.
- Permissions: request camera on first open; if denied, a "Open Settings" prompt.

---

## 8. Error codes (mobile app maps to copy)

Envelope: `{ success:false, code, error }` (matches the app's `ApiError` → reads `error` + `status`).

| code | HTTP | copy |
|---|---|---|
| `INVALID_QR` | 400/404 | QR code is invalid or tampered. |
| `INVALID_QR_PURPOSE` | 400 | This QR cannot be used for order pickup. |
| `ORDER_NOT_FOUND` | 404 | Order does not exist. |
| `STORE_MISMATCH` | 409 | This QR does not belong to this order/store. |
| `ORDER_NOT_READY` | 409 | This order is not ready for pickup. |
| `QR_ALREADY_USED` | 409 | This pickup QR has already been used. |
| `ORDER_CANCELLED` | 409 | This order has been cancelled. |
| `QR_REVOKED` | 409 | This pickup QR is no longer valid. |
| `PICKUP_NOT_AUTHORIZED` | 403 | You're not signed in as a delivery partner / this order is assigned to someone else. |

---

## 9. Config

- `PICKUP_QR_SECRET` — **new**, QC backend env only. `z.string().min(32)`. If unset,
  QR generation throws on `mark-ready` (fail loud — the feature can't work without it).
- No new gateway / seller-app / notification env.

---

## 10. Build order

1. QC backend: `OrderPickupQR` model + `PICKUP_QR_SECRET` + `OrderPickupService` (generate + verify), unwired.
2. QC backend: `verifyPlatformTokenRaw` + `requirePartner`.
3. QC backend: wire generation into `mark-ready`; add `back-to-preparing`; revoke on `CANCELLED` / store-delete; remove the `handoverCode` / `mark-handed-over` path; `forSeller` DTO carries `pickupQr`.
4. QC backend: routes (`verify-qr`, `pickup-qr`, `back-to-preparing`).
5. QC backend: `src/scripts/testPickupQr.ts` — positive + negative + concurrency + reprepare + cross-store (spec §17 tests).
6. QC backend: `src/scripts/backfillPickupQr.ts` — mint a QR for every current `fulfillmentStatus:'READY'` order.
7. Seller app: `react-native-qrcode-svg` + OrderDetail QR card + drop the code input.
8. Partner app: `react-native-vision-camera` + `ScanPickupQrScreen` + entry point (native rebuild, minSdk bump).
9. Deploy: QC backend → (gateway unchanged) → seller app build → partner app build.

---

## 11. Test scenarios (`testPickupQr.ts`)

Positive: mark-ready mints ACTIVE QR · GET pickup-qr returns it · valid scan →
`HANDED_OVER` + QR `USED` + `order.partnerUid` set · partner scans hours later
while still `READY` → still works.

Negative: tampered token · bad signature · `purpose` ≠ `ORDER_PICKUP` · unknown
order · `STORE_MISMATCH` (QR from store A vs order of store B) · order already
`HANDED_OVER` · order `CANCELLED` (QR auto-revoked) · `REVOKED` QR · re-scan of a
`USED` QR · non-partner token → 403 · **two concurrent scans → exactly one
`success`** · `back-to-preparing` then `mark-ready` → old `jti` rejected, new one
works · seller A cannot `GET` seller B's `pickup-qr`.

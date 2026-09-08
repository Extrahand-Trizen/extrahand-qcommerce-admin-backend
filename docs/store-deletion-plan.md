# Store / Seller Deletion — Audit & Implementation Plan

**Status:** approved, not implemented.
**Scope:** a seller deletes *their store*. Store + seller-scoped data is removed; the
shared user account and every other role (customer, helper, delivery partner) is
untouched. This is **role/store-scoped deletion, not account deletion** — unless
`seller` is the user's only role (then it falls through to full account deletion).

Repos touched: `extrahand-qcommerce-admin-backend` (primary),
`extrahand-user-service`, `extrahand-platform-notification-service`,
`extra-hand-seller` (app).

---

## 0. Architecture facts that drive the design

1. **There is no `Store` model.** A "store" = `Seller` + `SellerOnboarding` +
   `SellerStoreSettings`, all keyed by `sellerId` (`Seller._id`).
   `Seller.userId` is the Firebase uid and is **unique + required**.
2. **The seller app is single-role.** No role switching inside it. Customer /
   helper / partner live in *other apps* on *other services*. So frontend cleanup
   in the seller app is just a normal full logout; the multi-role concern is
   **entirely backend** (user-service + notification-service, which are shared).
3. **`CustomerOrder` is shared** between seller, customer (`userId`) and delivery
   partner (`partnerId` / `assigneeId` / `assigneeUid`).
4. **There is no separate payments/ledger collection.** Payment status, Razorpay
   ids, refunds and amounts are embedded in `CustomerOrder`.
   `SellerPaymentService` computes payouts/settlements on the fly from it.
5. **`storage.ts` has no delete function** — uploaded assets (shop photo, FSSAI
   certificate) currently cannot be removed. Must be added.
6. **Precedent exists:** `PrivacyController` supports `scope: 'partner'` →
   `PrivacyService.requestPartnerScopedDeletion` (`$pull` the role, reset the
   sub-profile, keep the account; full-delete if partner was the only role). The
   seller flow mirrors this.

---

## 1. Approved decisions

| # | Question | Decision |
|---|---|---|
| 1 | `Seller` record | **Soft-delete, permanent** — `status: 'DELETED'`, row kept forever, no purge job |
| 2 | `Seller.userId` after delete | Mangle to `deleted:<uid>:<ts>` (keeps unique+required) so the real uid is free |
| 3 | Re-registration | **Allowed immediately** (thanks to #2) — new onboarding from scratch |
| 4 | KYC (`SellerOnboarding`) + uploaded files | **Hard-delete** rows + remove FSSAI cert + shop photo from MinIO |
| 5 | Orders + payments (`CustomerOrder`) | **Hard-delete** every row for this `sellerId`, store-scoped only |
| 6 | `PromotionRedemption` | **Hard-delete** (store-scoped, tied to those orders) |
| 7 | `CustomerCart` bound to the store | **Hard-delete** (`deleteMany({ sellerId })`) |
| 8 | `SellerListing`, `ShopInventory`, `Promotion`, `SellerStoreSettings` (incl. bank account) | **Hard-delete** |
| 9 | `ProductSubmission` | **Hard-delete** rows; **never** touch `mappedMasterProductId` |
| 10 | In-flight orders at delete time | **Block** with `409` until resolved |
| 11 | Seller-only account | Fall through to **existing full account deletion** (anonymize `Profile`, remove Firebase) |
| 12 | Multi-role account | `$pull: 'seller'` from `Profile.roles`, clear `sellerProfile`, keep account + Firebase + all other-role data |
| 13 | Seller notifications | Delete `InAppNotification` where `userId=X AND data.recipientRole='seller'` (+ legacy `QC_*` eventKeys) |
| 14 | `FCMToken` (notification-service) | **Never** delete by `userId` (shared device). Only clear `Seller.fcmTokens[]` |
| 15 | Entry point | **Seller app → Settings → Delete Store** only |
| 16 | `SellerApprovalHistory` | **OPEN** — recommended: keep (admin review audit, detached). Delete only if product owner asks. |

### Accepted consequences of #5 (explicitly chosen)

For the deleted store's orders only: the customer's order-history entries for
those orders disappear from the customer app; the delivery partner loses those
deliveries and their earnings records; the refund / Razorpay audit trail for
them is destroyed. **Irreversible.** Other stores', other customers', and other
partners' data is not affected (`{ sellerId }` filter).

---

## 2. Data map

### `extrahand-qcommerce-admin-backend`

| Model | Key | Category | Action |
|---|---|---|---|
| `Seller` | `_id`, `userId` | store root | **soft-delete** — `status='DELETED'`, `fcmTokens=[]`, mangle `userId` |
| `SellerOnboarding` | `sellerId` uniq | store (PII/KYC) | **hard-delete** + delete `shopImageUrl` file |
| `SellerDocument` | `sellerId` | store (PII) | **hard-delete** rows + delete every `fileUrl` |
| `SellerStoreSettings` | `sellerId` uniq | store (bank acct) | **hard-delete** |
| `SellerListing` | `sellerId` | store products | **hard-delete** |
| `ShopInventory` | `sellerId`, `listingId` | store | **hard-delete** |
| `Promotion` | `sellerId` | store | **hard-delete** |
| `PromotionRedemption` | `sellerId` | store + order | **hard-delete** |
| `ProductSubmission` | `sellerId`, `mappedMasterProductId` | store | **hard-delete** rows; keep master product |
| `CustomerOrder` | `sellerId` + `userId` + `partnerId` | shared (3 roles) | **hard-delete** `{ sellerId }` (per decision #5) |
| `CustomerCart` | `sellerId` (opt) | customer | **hard-delete** `{ sellerId }` |
| `SellerApprovalHistory` | `sellerId` | store/admin audit | **keep** (flagged #16) |
| `MasterProduct`, `Category`, `Subcategory`, `ProductType`, `Attribute`, `ProductTypeAttribute`, `ProductImage` | — | **platform** | **never touch** |
| `AdminUser`, `AdminInvite`, `CustomerWishlist` | — | platform / other | **never touch** |

### `extrahand-user-service`

| Target | Action |
|---|---|
| `Profile` (account) | **keep** if any non-seller role remains |
| `Profile.roles` | `$pull: 'seller'` |
| `Profile.sellerProfile` | reset to `{}` |
| Firebase identity | **keep** (unless seller-only → full delete) |
| Seller-only account | full account deletion via existing `PrivacyService` full path |

### `extrahand-platform-notification-service`

| Model | Key | Action |
|---|---|---|
| `InAppNotification` | `userId` + `data.recipientRole` | delete `userId=X AND recipientRole='seller'` (+ `data.eventKey ∈ {QC_ORDER_PLACED, QC_ORDER_AUTO_REJECTED, QC_SHOP_AUTO_PAUSED, QC_SHOP_REOPENED, QC_STOCK_OUT}` for legacy untagged). **Never** delete `recipientRole ∈ [tasker, partner, customer]` or task-category rows |
| `FCMToken` | `userId` (shared device) | **never** `deleteMany({ userId })`. If the seller app registered a token here, delete by exact token string only |
| `NotificationPreferences` | `uid` | **keep** |

### `extra-hand-seller` (app)

No role state to preserve. On delete success: `useSessionStore.logout()`
(already resets payment/order/shop stores) **+**
`AsyncStorage.multiRemove` of every `STORAGE_KEYS` value **+** `navigation.reset`
to `Welcome`.

---

## 3. Existing implementation & its risks

**`SellerService.deleteSeller(id)`** → `DELETE /api/v1/sellers/:id`, **admin only**
(`...admin`). No seller-facing delete exists.

```
deleteMany: SellerOnboarding, SellerDocument, SellerApprovalHistory, SellerListing, ProductSubmission
findByIdAndDelete: Seller
```

Risks:
1. **Misses** `SellerStoreSettings` (bank details orphaned), `ShopInventory`,
   `Promotion`, `PromotionRedemption`, `CustomerCart`, `CustomerOrder`.
2. **No user-service call** → `roles: ['seller']` + `sellerProfile.sellerId`
   persist → ghost seller role forever.
3. **No notification-service call** → seller notifications stay in the shared store.
4. **No asset deletion** → FSSAI certs + shop photos (PII) orphaned in MinIO.
5. **`Promise.all`, no transaction** → partial failure leaves a half-deleted store.
6. **Hard-deletes `Seller`** → `CustomerOrder.sellerId` becomes a dangling ref
   (we accept full-order-delete now, so this changes — see plan).
7. **`Seller.userId` unique** + `registerSeller` returns existing → re-registration
   handling needed.
8. Deletes `SellerApprovalHistory` (decision #16 says keep).

---

## 4. Endpoint spec — `DELETE /api/v1/seller/store`

Auth: `...requireSeller`. Body: `{ confirm: true }` (reject without it).

1. Load `Seller` by `req.user.sellerId`. `404` if missing or already `DELETED`.
2. **In-flight guard:**
   `CustomerOrder.countDocuments({ sellerId, fulfillmentStatus: { $in: ['PENDING_ACCEPT','ACCEPTED','PREPARING','READY'] } })`
   → `409 { error: 'You have N active orders — hand them over or reject them first.' }`.
3. Collect asset URLs: `SellerOnboarding.shopImageUrl` + every `SellerDocument.fileUrl`.
4. **Mongo transaction** (Atlas replica set supports it):
   - `Seller.updateOne`: `status='DELETED'`, `fcmTokens=[]`,
     `userId = 'deleted:' + userId + ':' + Date.now()`
   - `deleteMany({ sellerId })` on: `SellerOnboarding`, `SellerDocument`,
     `SellerStoreSettings`, `SellerListing`, `ShopInventory`, `Promotion`,
     `PromotionRedemption`, `ProductSubmission`, `CustomerOrder`, `CustomerCart`
   - (`SellerApprovalHistory` left in place — decision #16)
5. **After commit** — best-effort, each wrapped in try/catch + logged, never fail the request:
   - `storage.deleteFile(url)` for each collected URL
   - `UserServiceClient.unlinkSeller(realUserId)` — user-service decides scoped vs full delete
   - `NotificationServiceClient.purgeSellerNotifications(realUserId)`
6. Respond `{ deleted: true }`.

**Access is cut automatically:** `attachSeller` middleware does
`Seller.findOne({ userId })`; the mangled `userId` no longer matches → every
seller route returns `404`. Add an explicit `status !== 'DELETED'` check in
`attachSeller` as belt-and-suspenders. Also exclude `status: 'DELETED'` in
`StorefrontService` / `QcOrderService.checkout` so customers can't reach a dead
store.

---

## 5. Files to change

### `extrahand-qcommerce-admin-backend`
- `src/services/SellerService.ts` — new `deleteOwnStore(sellerId, { confirm })` (transactional, per §4). Bring admin `deleteSeller` to the same coverage.
- `src/routes/sellerStore.ts` — new `DELETE /seller/store` (`...requireSeller`).
- `src/middleware/auth.ts` — `attachSeller`: reject `status === 'DELETED'`.
- `src/utils/storage.ts` — add `deleteFile(url: string)` (MinIO `removeObject` from the key in the URL; local `fs.unlink`).
- `src/services/UserServiceClient.ts` — add `unlinkSeller(userId)` → `PUT {USER_SERVICE_URL}/api/v1/profiles/internal/:uid` (or a dedicated route) with role pull + `sellerProfile: {}`, `X-Service-Auth`.
- `src/services/NotificationServiceClient.ts` — **new**. `purgeSellerNotifications(userId)` → `DELETE {NOTIFICATION_SERVICE_URL}/api/v1/notifications/in-app/purge`, `X-Service-Auth`.
- `src/services/StorefrontService.ts`, `src/services/QcOrderService.ts` (checkout) — exclude `status: 'DELETED'` sellers.

### `extrahand-user-service`
- `src/utils/roleDeletionScope.ts` — `profileHasSellerCapability`, `getRolesAfterRemovingSeller`.
- `src/services/PrivacyService.ts` — `requestSellerScopedDeletion(userId, reason)` mirroring `requestPartnerScopedDeletion`, **including its "seller was the only role → full account delete" safety net**.
- `src/controllers/PrivacyController.ts` — accept `scope: 'seller'`.
- `src/routes/profiles.ts` — internal `PUT /internal/:uid`: verify it accepts a `roles` replacement + `sellerProfile: {}` clear (it already replaces roles on write; confirm `sellerProfile` can be emptied), or add `PUT /internal/:uid/unlink-seller`.

### `extrahand-platform-notification-service`
- New service-auth route `DELETE /api/v1/notifications/in-app/purge`, body `{ userId, role: 'seller' }`. Deletes `InAppNotification` where `userId` matches **and** (`data.recipientRole === role` **or** `data.eventKey ∈ SELLER_QC_EVENTS`). **Reject** a request that omits `role` or passes a bare `userId` with no role.

### `extra-hand-seller` (app)
- `src/features/shop-profile/screens/DeleteStoreScreen.tsx` — **new**, reached from `SettingsScreen`.
- `src/api/sellerStore.ts` — `deleteStore()` → `DELETE /seller/store` `{ confirm: true }`.
- On success: `useSessionStore.getState().logout()` + `AsyncStorage.multiRemove(Object.values(STORAGE_KEYS))` + `navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] })`.
- Confirmation UX: two-step — a warning screen listing what's removed, then a typed-confirm or checkbox gating a red **Delete Store** button. Copy:
  > *Deleting your store permanently removes your products, orders, payments, store details, bank information and seller notifications. This cannot be undone.*
  (No "other roles unaffected" line — this app has no other roles.)
  Also surface the `409` in-flight-orders message inline.

---

## 6. Build order

1. `storage.deleteFile` + `UserServiceClient.unlinkSeller` + `NotificationServiceClient` (small, independent).
2. notification-service `purge` endpoint.
3. user-service seller-scoped privacy path (mirror partner).
4. QC backend `deleteOwnStore` (transactional) + route + `attachSeller` / storefront / checkout guards; admin `deleteSeller` parity.
5. seller app `DeleteStoreScreen` + teardown.
6. Multi-role acceptance test (§7).

---

## 7. Acceptance test

Create `User A` with roles `["seller", "partner"]`.
- Seller: `Store A` with products, listings, a promotion, ≥2 completed `CustomerOrder`s (paid), `SellerStoreSettings` with a bank account, FSSAI cert + shop photo uploaded, seller `InAppNotification`s.
- Partner: partner profile, delivery history, partner `InAppNotification`s, partner settings (all in the task/partner services).

Delete `Store A`.

**Must be gone:**
- `Seller` shows `status: 'DELETED'`, `userId` mangled.
- `SellerOnboarding`, `SellerDocument`, `SellerStoreSettings`, `SellerListing`, `ShopInventory`, `Promotion`, `PromotionRedemption`, `ProductSubmission`, `CustomerCart`, **`CustomerOrder`** for that `sellerId` — 0 rows.
- FSSAI cert + shop photo — 404 in MinIO.
- Seller `InAppNotification`s — 0.
- `Profile.roles` — `["partner"]`; `Profile.sellerProfile` — `{}`.
- Every seller API (`/seller/store-settings`, `/seller/listings`, `/seller/orders`, `/seller/metrics`, …) with the old token → `404`.

**Must remain, working:**
- `Profile` account + Firebase identity.
- Partner login, profile, delivery history, partner notifications, partner settings, partner APIs.
- `MasterProduct` / catalogue rows the store had listed.
- Other sellers' `Seller` / listings / orders — untouched.
- `FCMToken` rows for `User A` — the partner app's token still present.

**Re-registration:** `User A` opens the seller app again → new OTP → `registerSeller` creates a fresh `Seller` (old mangled row ignored) → onboarding from step 1.

---

## 8. Still open

- **Decision #16** — delete `SellerApprovalHistory` too, or keep it as detached admin audit? (Recommend keep.)
- Confirm the MinIO bucket credentials on the QC backend allow `removeObject`.
- Confirm no external payout processor holds a mandate against seller bank accounts (audit says `SellerPaymentService` is read-only compute — looks safe).

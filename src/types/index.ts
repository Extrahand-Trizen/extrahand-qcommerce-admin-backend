export const ENTITY_STATUS = ['ACTIVE', 'INACTIVE'] as const;
export type EntityStatus = (typeof ENTITY_STATUS)[number];

export const ATTRIBUTE_TYPES = ['TEXT', 'NUMBER', 'DROPDOWN', 'MULTI_SELECT', 'BOOLEAN'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export const SELLER_STATUS = ['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'REJECTED', 'DELETED'] as const;
export type SellerStatus = (typeof SELLER_STATUS)[number];

export const ONBOARDING_STATUS = ['DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUIRED', 'APPROVED', 'REJECTED'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUS)[number];

// Seller onboarding collects the FSSAI certificate and a photo of the shop as
// uploaded documents. PAN and GSTIN are captured as numbers on the onboarding
// record, not uploads. (Legacy SellerDocument rows with other types still read
// fine — enum is only validated on write.)
export const DOCUMENT_TYPES = ['FSSAI_CERTIFICATE', 'SHOP_IMAGE', 'BANK_PASSBOOK'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_VERIFICATION_STATUS = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type DocumentVerificationStatus = (typeof DOCUMENT_VERIFICATION_STATUS)[number];

export const APPROVAL_ACTIONS = ['SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const SUBMISSION_STATUS = ['PENDING', 'CHANGES_REQUIRED', 'APPROVED', 'REJECTED'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];

export const LISTING_STATUS = ['ACTIVE', 'INACTIVE'] as const;
export type ListingStatus = (typeof LISTING_STATUS)[number];

export const AVAILABILITY = ['AVAILABLE', 'LIMITED', 'OUT_OF_STOCK'] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const LISTING_REVIEW_STATUS = ['APPROVED', 'PENDING_REVIEW'] as const;
export type ListingReviewStatus = (typeof LISTING_REVIEW_STATUS)[number];

export const USER_ROLES = ['SUPER_ADMIN', 'CATALOGUE_ADMIN', 'SELLER_OPERATIONS_ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Alias for admin-specific role management — same values as USER_ROLES */
export const ADMIN_ROLES = USER_ROLES;
export type AdminRole = UserRole;

/** Status values for admin user accounts */
export const ADMIN_STATUS = ['active', 'inactive', 'suspended'] as const;
export type AdminStatus = (typeof ADMIN_STATUS)[number];

export const STORE_STATUS = ['OPEN', 'CLOSED'] as const;
export type StoreStatus = (typeof STORE_STATUS)[number];

/** MANUAL: the seller flips the switch. SCHEDULED: open/closed follows the hours. */
export const STORE_STATUS_MODE = ['MANUAL', 'SCHEDULED'] as const;
export type StoreStatusMode = (typeof STORE_STATUS_MODE)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const PROMOTION_TYPE = ['PERCENT', 'FLAT'] as const;
export type PromotionType = (typeof PROMOTION_TYPE)[number];

/** Stored state. SCHEDULED / EXPIRED / EXHAUSTED are derived from dates + usage. */
export const PROMOTION_STATE = ['ACTIVE', 'PAUSED'] as const;
export type PromotionState = (typeof PROMOTION_STATE)[number];

/** CODE: customer types a code at checkout. AUTOMATIC: discounted price is shown
 *  on the storefront and applied without any code (product offers only). */
export const PROMOTION_TRIGGER = ['CODE', 'AUTOMATIC'] as const;
export type PromotionTrigger = (typeof PROMOTION_TRIGGER)[number];

/** ORDER: discount is calculated on the whole cart. PRODUCTS: only on the lines
 *  whose product is in `productMasterIds`. */
export const PROMOTION_APPLIES_TO = ['ORDER', 'PRODUCTS'] as const;
export type PromotionAppliesTo = (typeof PROMOTION_APPLIES_TO)[number];

export interface PaginationQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditFields {
  createdBy?: string;
  updatedBy?: string;
}

export interface ProductAttributeValue {
  attributeId: string;
  value: string | number | boolean | string[];
}

/** Structured nutrition facts — separate from catalogue attributes. */
export interface NutritionInformation {
  servingSize?: string;
  energy?: string;
  protein?: string;
  carbohydrates?: string;
  totalFat?: string;
  saturatedFat?: string;
  sugar?: string;
  sodium?: string;
}

/** Regulatory / descriptive product info — not part of ProductTypeAttribute mappings. */
export interface ProductInformation {
  ingredients?: string;
  manufacturer?: string;
  storageInformation?: string;
  usageInstructions?: string;
  nutritionInformation?: NutritionInformation;
  allergens?: string;
  healthBenefits?: string;
  specialFeatures?: string;
}

export const LIFESPAN_UNITS = ['Hours', 'Days', 'Weeks', 'Months', 'Years'] as const;
export type LifespanUnit = (typeof LIFESPAN_UNITS)[number];

export const RESERVATION_STATUS = ['RESERVED', 'FINALIZED', 'RELEASED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUS)[number];

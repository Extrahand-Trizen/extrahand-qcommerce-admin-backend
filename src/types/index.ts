export const ENTITY_STATUS = ['ACTIVE', 'INACTIVE'] as const;
export type EntityStatus = (typeof ENTITY_STATUS)[number];

export const ATTRIBUTE_TYPES = ['TEXT', 'NUMBER', 'DROPDOWN', 'MULTI_SELECT', 'BOOLEAN'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export const SELLER_STATUS = ['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'REJECTED'] as const;
export type SellerStatus = (typeof SELLER_STATUS)[number];

export const ONBOARDING_STATUS = ['DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUIRED', 'APPROVED', 'REJECTED'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUS)[number];

export const DOCUMENT_TYPES = [
  'PAN_CARD', 'ADDRESS_PROOF', 'BUSINESS_PROOF', 'SHOP_FRONT_PHOTO',
  'GST_CERTIFICATE', 'FSSAI_CERTIFICATE', 'OTHER_LICENSE',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_VERIFICATION_STATUS = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type DocumentVerificationStatus = (typeof DOCUMENT_VERIFICATION_STATUS)[number];

export const APPROVAL_ACTIONS = ['SUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const SUBMISSION_STATUS = ['PENDING', 'CHANGES_REQUIRED', 'APPROVED', 'REJECTED'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];

export const LISTING_STATUS = ['ACTIVE', 'INACTIVE'] as const;
export type ListingStatus = (typeof LISTING_STATUS)[number];

export const AVAILABILITY = ['AVAILABLE', 'LIMITED', 'OUT_OF_STOCK'] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const LISTING_REVIEW_STATUS = ['APPROVED', 'PENDING_REVIEW'] as const;
export type ListingReviewStatus = (typeof LISTING_REVIEW_STATUS)[number];

export const USER_ROLES = ['ADMIN', 'SELLER', 'CUSTOMER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

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
}

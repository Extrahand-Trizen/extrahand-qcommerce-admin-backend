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

export const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'CATALOGUE_ADMIN',
  'SELLER_OPERATIONS_ADMIN',
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_STATUS = ['active', 'suspended', 'inactive'] as const;
export type AdminStatus = (typeof ADMIN_STATUS)[number];

export const USER_ROLES = [
  ...ADMIN_ROLES,
  'ADMIN',
  'SELLER',
  'CUSTOMER',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

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
  healthBenefits?: string;
  specialFeatures?: string;
  storageInformation?: string;
  usageInstructions?: string;
  nutritionInformation?: NutritionInformation;
  allergens?: string;
}

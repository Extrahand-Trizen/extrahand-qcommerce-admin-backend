export declare const ENTITY_STATUS: readonly ["ACTIVE", "INACTIVE"];
export type EntityStatus = (typeof ENTITY_STATUS)[number];
export declare const ATTRIBUTE_TYPES: readonly ["TEXT", "NUMBER", "DROPDOWN", "MULTI_SELECT", "BOOLEAN"];
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];
export declare const SELLER_STATUS: readonly ["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED", "REJECTED"];
export type SellerStatus = (typeof SELLER_STATUS)[number];
export declare const ONBOARDING_STATUS: readonly ["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUIRED", "APPROVED", "REJECTED"];
export type OnboardingStatus = (typeof ONBOARDING_STATUS)[number];
export declare const DOCUMENT_TYPES: readonly ["PAN_CARD", "ADDRESS_PROOF", "SHOP_FRONT_PHOTO", "GST_CERTIFICATE", "FSSAI_CERTIFICATE", "OTHER_LICENSE"];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export declare const DOCUMENT_VERIFICATION_STATUS: readonly ["PENDING", "VERIFIED", "REJECTED"];
export type DocumentVerificationStatus = (typeof DOCUMENT_VERIFICATION_STATUS)[number];
export declare const APPROVAL_ACTIONS: readonly ["SUBMITTED", "APPROVED", "REJECTED", "CHANGES_REQUESTED"];
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export declare const SUBMISSION_STATUS: readonly ["PENDING", "CHANGES_REQUIRED", "APPROVED", "REJECTED"];
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];
export declare const LISTING_STATUS: readonly ["ACTIVE", "INACTIVE"];
export type ListingStatus = (typeof LISTING_STATUS)[number];
export declare const AVAILABILITY: readonly ["AVAILABLE", "UNAVAILABLE"];
export type Availability = (typeof AVAILABILITY)[number];
export declare const USER_ROLES: readonly ["ADMIN", "SELLER", "CUSTOMER"];
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

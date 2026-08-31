import { PaginationQuery } from '../types';
export declare class SellerService {
    static listSellers(query: PaginationQuery & {
        status?: string;
        onboardingStatus?: string;
    }): Promise<import("../types").PaginatedResult<import("../models/Seller").ISeller>>;
    static getSeller(id: string): Promise<{
        seller: import("mongoose").Document<unknown, {}, import("../models/Seller").ISeller, {}, {}> & import("../models/Seller").ISeller & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
        onboarding: (import("mongoose").Document<unknown, {}, import("../models/SellerOnboarding").ISellerOnboarding, {}, {}> & import("../models/SellerOnboarding").ISellerOnboarding & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        }) | null;
        documents: (import("mongoose").Document<unknown, {}, import("../models/SellerDocument").ISellerDocument, {}, {}> & import("../models/SellerDocument").ISellerDocument & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        })[];
        history: (import("mongoose").Document<unknown, {}, import("../models/SellerApprovalHistory").ISellerApprovalHistory, {}, {}> & import("../models/SellerApprovalHistory").ISellerApprovalHistory & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        })[];
    }>;
    static listApprovals(query: PaginationQuery & {
        status?: string;
        shopType?: string;
        city?: string;
    }): Promise<import("../types").PaginatedResult<import("../models/SellerOnboarding").ISellerOnboarding>>;
    static reviewOnboarding(sellerId: string, action: 'APPROVE' | 'REJECT' | 'CHANGES_REQUESTED', comment: string | undefined, adminId: string): Promise<{
        seller: import("mongoose").Document<unknown, {}, import("../models/Seller").ISeller, {}, {}> & import("../models/Seller").ISeller & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
        onboarding: import("mongoose").Document<unknown, {}, import("../models/SellerOnboarding").ISellerOnboarding, {}, {}> & import("../models/SellerOnboarding").ISellerOnboarding & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
    }>;
    static updateSellerStatus(id: string, status: string): Promise<import("mongoose").Document<unknown, {}, import("../models/Seller").ISeller, {}, {}> & import("../models/Seller").ISeller & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static registerSeller(data: {
        userId: string;
        fullName: string;
        mobileNumber: string;
        email?: string;
    }): Promise<import("mongoose").Document<unknown, {}, import("../models/Seller").ISeller, {}, {}> & import("../models/Seller").ISeller & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static saveOnboarding(sellerId: string, data: Record<string, unknown>, submit?: boolean): Promise<import("mongoose").Document<unknown, {}, import("../models/SellerOnboarding").ISellerOnboarding, {}, {}> & import("../models/SellerOnboarding").ISellerOnboarding & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
}

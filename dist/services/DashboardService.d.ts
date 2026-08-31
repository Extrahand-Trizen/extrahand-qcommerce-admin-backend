export declare class DashboardService {
    static getStats(): Promise<{
        totalSellers: number;
        activeSellers: number;
        pendingSellerApprovals: number;
        totalCategories: number;
        totalSubcategories: number;
        totalProductTypes: number;
        totalMasterProducts: number;
        activeProducts: number;
        pendingProductSubmissions: number;
    }>;
    static getRecentActivity(): Promise<{
        recentSellers: (import("mongoose").FlattenMaps<import("../models/Seller").ISeller> & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        })[];
        recentApprovedSellers: (import("mongoose").FlattenMaps<import("../models/Seller").ISeller> & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        })[];
        recentProducts: (import("mongoose").FlattenMaps<import("../models/MasterProduct").IMasterProduct> & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        })[];
        recentSubmissions: (import("mongoose").FlattenMaps<import("../models/ProductSubmission").IProductSubmission> & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        })[];
        pendingApprovals: (import("mongoose").FlattenMaps<import("../models/SellerOnboarding").ISellerOnboarding> & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        })[];
    }>;
}

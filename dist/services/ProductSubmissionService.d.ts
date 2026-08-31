import { PaginationQuery } from '../types';
export declare class ProductSubmissionService {
    static list(query: PaginationQuery & {
        status?: string;
        sellerId?: string;
    }): Promise<import("../types").PaginatedResult<import("../models/ProductSubmission").IProductSubmission>>;
    static getById(id: string): Promise<import("mongoose").Document<unknown, {}, import("../models/ProductSubmission").IProductSubmission, {}, {}> & import("../models/ProductSubmission").IProductSubmission & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    static review(id: string, action: string, adminComment: string | undefined, adminId: string, masterProductId?: string): Promise<import("mongoose").Document<unknown, {}, import("../models/ProductSubmission").IProductSubmission, {}, {}> & import("../models/ProductSubmission").IProductSubmission & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
}

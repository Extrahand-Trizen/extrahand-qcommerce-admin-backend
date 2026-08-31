import { PaginationQuery, PaginatedResult } from '../types';
import { FilterQuery, Model } from 'mongoose';
export declare function parsePagination(query: PaginationQuery): {
    page: number;
    limit: number;
    skip: number;
    sortBy: string;
    sortOrder: 1 | -1;
};
export declare function paginate<T>(model: Model<T>, filter: FilterQuery<T>, query: PaginationQuery, populate?: string | string[]): Promise<PaginatedResult<T>>;

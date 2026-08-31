import { PaginationQuery, PaginatedResult } from '../types';
import { FilterQuery, Model, SortOrder } from 'mongoose';

export function parsePagination(query: PaginationQuery) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy || 'createdAt';
  const sortOrder: SortOrder = query.sortOrder === 'asc' ? 1 : -1;
  return { page, limit, skip, sortBy, sortOrder };
}

export async function paginate<T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  query: PaginationQuery,
  populate?: string | string[]
): Promise<PaginatedResult<T>> {
  const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
  const sort = { [sortBy]: sortOrder } as Record<string, SortOrder>;

  let q = model.find(filter).sort(sort).skip(skip).limit(limit);
  if (populate) q = q.populate(populate);

  const [items, total] = await Promise.all([
    q.lean(),
    model.countDocuments(filter),
  ]);

  return {
    items: items as T[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

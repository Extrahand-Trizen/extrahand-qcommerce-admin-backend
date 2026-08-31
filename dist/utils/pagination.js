"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePagination = parsePagination;
exports.paginate = paginate;
function parsePagination(query) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    return { page, limit, skip, sortBy, sortOrder };
}
async function paginate(model, filter, query, populate) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const sort = { [sortBy]: sortOrder };
    let q = model.find(filter).sort(sort).skip(skip).limit(limit);
    if (populate)
        q = q.populate(populate);
    const [items, total] = await Promise.all([
        q.lean(),
        model.countDocuments(filter),
    ]);
    return {
        items: items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
    };
}

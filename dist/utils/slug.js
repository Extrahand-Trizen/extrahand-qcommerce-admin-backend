"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugify = slugify;
exports.uniqueSlug = uniqueSlug;
function slugify(text) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
async function uniqueSlug(base, exists) {
    let slug = slugify(base);
    let counter = 0;
    while (await exists(slug)) {
        counter += 1;
        slug = `${slugify(base)}-${counter}`;
    }
    return slug;
}

import Category from '../models/Category';
import MasterProduct from '../models/MasterProduct';
import { AppError } from './response';

/** Uppercase, alphanumeric, hyphen-free slug fragment for the SKU body. */
function skuFragment(text: string, maxLen = 24): string {
  return text
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '');
}

/**
 * Generate the next master-product SKU: `MP-<CATCODE>-<NAME>-<SEQ>`
 * e.g. MP-FRESH-APPLE-004. SEQ is the next free 3-digit number within that
 * category prefix. Deterministic, collision-checked.
 */
export async function generateMasterProductSku(
  categoryId: string,
  name: string,
): Promise<string> {
  const category = await Category.findById(categoryId).select('code');
  if (!category?.code) {
    throw new AppError('Category has no code — run the catalogue migration', 400);
  }

  const prefix = `MP-${category.code}-`;
  // Drop a leading name word that just repeats the category code (e.g.
  // "Fresh Dragon Fruit" in category FRESH -> "DRAGON-FRUIT").
  const words = name.trim().split(/\s+/);
  const trimmedName =
    words.length > 1 && words[0].toUpperCase() === category.code
      ? words.slice(1).join(' ')
      : name;
  const body = skuFragment(trimmedName) || 'ITEM';

  // Highest existing sequence for this category prefix.
  const existing = await MasterProduct.find({ sku: new RegExp(`^${prefix}`) })
    .select('sku')
    .lean();
  let maxSeq = 0;
  for (const p of existing) {
    const m = /-(\d{1,})$/.exec(p.sku);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  }

  // Find the first free slot (guards against a manual duplicate).
  let seq = maxSeq + 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${prefix}${body}-${String(seq).padStart(3, '0')}`;
    const clash = await MasterProduct.exists({ sku: candidate });
    if (!clash) return candidate;
    seq += 1;
  }
}

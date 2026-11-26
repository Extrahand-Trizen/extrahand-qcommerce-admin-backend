/**
 * Reusable slug and code generation utilities across the platform.
 */

/**
 * Generates a clean URL-friendly slug from text.
 * e.g. "Sports & Fitness" -> "sports-and-fitness" or "sports-fitness"
 */
export function slugify(text: string, options?: { separator?: string; preserveAnd?: boolean }): string {
  const sep = options?.separator ?? '-';
  let str = String(text || '').trim();
  if (options?.preserveAnd) {
    str = str.replace(/&/g, ' and ');
  } else {
    str = str.replace(/&/g, ' ');
  }
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, sep)
    .replace(new RegExp(`^\\${sep}+|\\${sep}+$`, 'g'), '');
}

/**
 * Generates an uppercase snake_case code/key from text.
 * e.g. "Sports & Fitness" -> "SPORTS_FITNESS"
 */
export function generateCode(text: string, options?: { maxLength?: number; separator?: string }): string {
  const sep = options?.separator ?? '_';
  const clean = slugify(text, { separator: sep, preserveAnd: false }).toUpperCase();
  if (options?.maxLength && clean.length > options.maxLength) {
    return clean.slice(0, options.maxLength).replace(new RegExp(`\\${sep}+$`, 'g'), '');
  }
  return clean || 'CODE';
}

/**
 * Ensures a unique URL slug by appending incremental counter if collision exists.
 */
export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
  options?: { separator?: string; preserveAnd?: boolean }
): Promise<string> {
  const sep = options?.separator ?? '-';
  const cleanBase = slugify(base, options) || 'item';
  let slug = cleanBase;
  let counter = 0;
  while (await exists(slug)) {
    counter += 1;
    slug = `${cleanBase}${sep}${counter}`;
  }
  return slug;
}

/**
 * Ensures a unique uppercase code by appending incremental counter if collision exists.
 * e.g. "SPORTS_FITNESS", then "SPORTS_FITNESS_1", "SPORTS_FITNESS_2"
 */
export async function uniqueCode(
  base: string,
  exists: (code: string) => Promise<boolean>,
  options?: { maxLength?: number; separator?: string }
): Promise<string> {
  const sep = options?.separator ?? '_';
  const cleanBase = generateCode(base, options);
  let code = cleanBase;
  let counter = 0;
  while (await exists(code)) {
    counter += 1;
    const suffix = `${sep}${counter}`;
    if (options?.maxLength && cleanBase.length + suffix.length > options.maxLength) {
      const truncatedBase = cleanBase.slice(0, options.maxLength - suffix.length);
      code = `${truncatedBase}${suffix}`;
    } else {
      code = `${cleanBase}${suffix}`;
    }
  }
  return code;
}

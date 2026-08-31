export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>
): Promise<string> {
  let slug = slugify(base);
  let counter = 0;
  while (await exists(slug)) {
    counter += 1;
    slug = `${slugify(base)}-${counter}`;
  }
  return slug;
}

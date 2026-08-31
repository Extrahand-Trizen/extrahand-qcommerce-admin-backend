export declare function slugify(text: string): string;
export declare function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string>;

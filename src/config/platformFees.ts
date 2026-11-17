import MasterProduct from '../models/MasterProduct';
import Subcategory from '../models/Subcategory';
import Category from '../models/Category';

/**
 * Platform Fee Matrix by Product Category, Subcategory, and Shop Category.
 *
 * Implements item/product-level fee calculation so mixed-basket orders
 * charge the correct percentage according to retail profit margins.
 */

export const CATEGORY_PLATFORM_FEE_MAP: Record<string, number> = {
  // Fresh & Daily Essentials (`fresh`)
  dairy: 3.0,
  'fruits-veg': 3.5,
  'bread-eggs': 3.5,
  'meat-fish': 4.5,

  // Grocery & Staples (`grocery`)
  'atta-rice': 3.0,
  masala: 4.0,
  breakfast: 4.5,
  packaged: 4.5,

  // Snacks & Beverages (`snacks`)
  'tea-coffee': 4.5,
  'cold-drinks': 5.0,
  munchies: 5.0,
  biscuits: 5.0,
  sweets: 5.0,
  icecream: 5.0,
  frozen: 5.0,

  // Beauty & Grooming (`beauty`)
  'personal-care': 5.5,
  skincare: 6.0,
  makeup: 6.5,
  fragrance: 7.0,
  'bath-body': 6.0,
  haircare: 6.0,

  // Health & Wellness (`health`)
  pharmacy: 3.5,
  protein: 5.5,
  feminine: 4.5,

  // Baby Care (`baby`)
  'baby-care': 4.0,
  'baby-wipes-toys': 5.0,

  // Home & Kitchen (`home`)
  cleaning: 5.0,
  'home-needs': 5.0,
  kitchenware: 5.5,

  // Books & Stationery (`stationery`)
  'books-stationery': 5.0,
  stationery: 5.0,

  // Pet Care (`pet`)
  'pet-care': 5.5,
  pet: 5.5,

  // Fashion & Apparel (`fashion`)
  apparel: 6.5,
  'clothing-footwear': 6.5,
  clothing: 6.5,
  jewellery: 7.0,

  // Electronics & Mobiles
  'mobiles-devices': 2.5,
  electronics: 2.5,
  'electronic-accessories': 5.0,

  // Flowers, Gifts & Bakery Cakes
  'flowers-bakery': 6.0,
  flowers: 6.0,
  gifts: 6.0,

  // Main Category Slug Fallbacks
  fresh: 3.5,
  grocery: 3.5,
  snacks: 5.0,
  beauty: 6.0,
  health: 4.0,
  baby: 4.0,
  home: 5.0,
  fashion: 6.5,

  // Shop Category Fallbacks (when order item category is missing)
  dairy_milk: 3.0,
  supermarket_grocery: 3.0,
  fruits_vegetables: 3.5,
  general_store: 4.0,
  medical_pharmacy: 3.5,
  bakery_sweets_snacks: 5.0,
  meat_poultry: 4.5,
  fish_seafood: 4.5,
  beauty_cosmetics: 6.0,
  home_kitchen: 5.0,
  hardware_electrical: 4.0,
  toys_baby_products: 4.0,
  pet_supplies: 5.5,
  electronics_mobiles: 2.5,
  clothing_fashion: 6.0,
  footwear: 6.0,
  flowers_gifts_lifestyle: 6.0,
  other_local_business: 5.0,
  other: 5.0,
};

/** Default platform commission percentage if no category match is found. */
export const DEFAULT_PLATFORM_FEE_PERCENT = 5.0;

/** GST percentage applicable to platform commission (18%). */
export const COMMISSION_GST_PERCENT = 18;

/** Default statutory SAC code for online marketplace platform fee. */
export const DEFAULT_SAC_CODE = '998313';

/** Default statutory SAC heading / description for online marketplace platform fee. */
export const DEFAULT_SAC_HEADING = 'Marketplace Facilitation & Platform Commission Fee';

// Dynamic DB fee overrides per category/subcategory slug
const dynamicCategoryFeeMap = new Map<
  string,
  { feePercent?: number; gstPercent?: number; sacCode?: string; sacHeading?: string }
>();

// In-memory productSlug -> category/subcategory slug cache
const slugToCategoryCache = new Map<string, string>();
let cacheLoadingPromise: Promise<void> | null = null;

/**
 * Initializes and caches all MasterProduct slugs to their respective subcategory/category slug,
 * and loads dynamic DB-configured platform fees, GST rates, SAC codes, and headings.
 */
export async function initProductCategoryCache(): Promise<void> {
  if (slugToCategoryCache.size > 0 && dynamicCategoryFeeMap.size > 0) return;
  if (cacheLoadingPromise) return cacheLoadingPromise;

  cacheLoadingPromise = (async () => {
    try {
      const [subcats, cats, mps] = await Promise.all([
        Subcategory.find({}).select('_id slug platformFeePercent gstPercent sacCode sacHeading').lean(),
        Category.find({}).select('_id slug platformFeePercent gstPercent sacCode sacHeading').lean(),
        MasterProduct.find({}).select('slug subcategoryId categoryId').lean(),
      ]);

      const subcatMap = new Map(subcats.map((s) => [s._id.toString(), s.slug]));
      const catMap = new Map(cats.map((c) => [c._id.toString(), c.slug]));

      for (const cat of cats as any[]) {
        if (cat.slug) {
          dynamicCategoryFeeMap.set(cat.slug.toLowerCase().trim(), {
            feePercent: cat.platformFeePercent,
            gstPercent: cat.gstPercent,
            sacCode: cat.sacCode || DEFAULT_SAC_CODE,
            sacHeading: cat.sacHeading || DEFAULT_SAC_HEADING,
          });
        }
      }

      for (const sub of subcats as any[]) {
        if (sub.slug) {
          dynamicCategoryFeeMap.set(sub.slug.toLowerCase().trim(), {
            feePercent: sub.platformFeePercent,
            gstPercent: sub.gstPercent,
            sacCode: sub.sacCode,
            sacHeading: sub.sacHeading,
          });
        }
      }

      for (const mp of mps) {
        if (!mp.slug) continue;
        const subSlug = mp.subcategoryId ? subcatMap.get(mp.subcategoryId.toString()) : undefined;
        const catSlug = mp.categoryId ? catMap.get(mp.categoryId.toString()) : undefined;
        const resolvedSlug = subSlug || catSlug;
        if (resolvedSlug) {
          slugToCategoryCache.set(mp.slug, resolvedSlug);
        }
      }
    } catch {
      // Non-fatal fallback
    } finally {
      cacheLoadingPromise = null;
    }
  })();

  return cacheLoadingPromise;
}

/**
 * Updates dynamic category fee in memory immediately upon admin save.
 */
export function setDynamicCategoryFee(
  slug: string,
  feePercent?: number,
  gstPercent?: number,
  sacCode?: string,
  sacHeading?: string,
): void {
  const normalized = slug.toLowerCase().trim();
  const existing = dynamicCategoryFeeMap.get(normalized) || {};
  if (feePercent !== undefined) existing.feePercent = feePercent;
  if (gstPercent !== undefined) existing.gstPercent = gstPercent;
  if (sacCode !== undefined) existing.sacCode = sacCode;
  if (sacHeading !== undefined) existing.sacHeading = sacHeading;
  dynamicCategoryFeeMap.set(normalized, existing);
}

/**
 * Returns dynamic or default SAC Code and Heading for a given category/subcategory.
 */
export function getCategorySacDetails(categoryOrSubcategorySlug?: string): { sacCode: string; sacHeading: string } {
  if (categoryOrSubcategorySlug) {
    const slug = categoryOrSubcategorySlug.toLowerCase().trim();
    const dynamicEntry = dynamicCategoryFeeMap.get(slug);
    if (dynamicEntry?.sacCode || dynamicEntry?.sacHeading) {
      return {
        sacCode: dynamicEntry.sacCode || DEFAULT_SAC_CODE,
        sacHeading: dynamicEntry.sacHeading || DEFAULT_SAC_HEADING,
      };
    }
  }
  return {
    sacCode: DEFAULT_SAC_CODE,
    sacHeading: DEFAULT_SAC_HEADING,
  };
}

/**
 * Returns dynamic or default GST percentage for a given category/subcategory.
 */
export function getCategoryGstPercent(categoryOrSubcategorySlug?: string): number {
  if (categoryOrSubcategorySlug) {
    const slug = categoryOrSubcategorySlug.toLowerCase().trim();
    const dynamicEntry = dynamicCategoryFeeMap.get(slug);
    if (dynamicEntry?.gstPercent != null) {
      return dynamicEntry.gstPercent;
    }
  }
  return COMMISSION_GST_PERCENT;
}

/**
 * Synchronous lookup for cached product slug.
 */
export function getCachedProductCategorySlug(productSlug?: string): string | undefined {
  if (!productSlug) return undefined;
  return slugToCategoryCache.get(productSlug);
}

/**
 * Resolves the platform fee percentage for a given category/subcategory, product slug, or shop category.
 */
export function getPlatformFeePercent(
  categoryOrSubcategorySlug?: string,
  shopCategory?: string,
  productSlug?: string,
): number {
  if (categoryOrSubcategorySlug) {
    const slug = categoryOrSubcategorySlug.toLowerCase().trim();
    const dynamicEntry = dynamicCategoryFeeMap.get(slug);
    if (dynamicEntry?.feePercent != null) {
      return dynamicEntry.feePercent;
    }
    if (CATEGORY_PLATFORM_FEE_MAP[slug] != null) {
      return CATEGORY_PLATFORM_FEE_MAP[slug];
    }
  }

  if (productSlug) {
    const cachedSlug = getCachedProductCategorySlug(productSlug);
    if (cachedSlug) {
      const dynamicEntry = dynamicCategoryFeeMap.get(cachedSlug);
      if (dynamicEntry?.feePercent != null) {
        return dynamicEntry.feePercent;
      }
      if (CATEGORY_PLATFORM_FEE_MAP[cachedSlug] != null) {
        return CATEGORY_PLATFORM_FEE_MAP[cachedSlug];
      }
    }
  }

  if (shopCategory) {
    const shopSlug = shopCategory.toLowerCase().trim();
    const dynamicEntry = dynamicCategoryFeeMap.get(shopSlug);
    if (dynamicEntry?.feePercent != null) {
      return dynamicEntry.feePercent;
    }
    if (CATEGORY_PLATFORM_FEE_MAP[shopSlug] != null) {
      return CATEGORY_PLATFORM_FEE_MAP[shopSlug];
    }
  }

  return DEFAULT_PLATFORM_FEE_PERCENT;
}

export interface OrderEarningsResult {
  grossPaise: number;
  commissionPaise: number;
  gstPaise: number;
  netEarningsPaise: number;
  effectivePercent: number;
}

/**
 * Calculates earnings and platform fee for an order.
 * If order items are present, calculates line-by-line using each product's category fee.
 * If items are not available, falls back to the shop category or default percentage.
 */
export function calculateOrderProductEarnings(params: {
  itemTotalPaise?: number;
  items?: Array<{
    productSlug?: string;
    lineTotalPaise?: number;
    categorySlug?: string;
    subcategorySlug?: string;
    platformFeePercent?: number;
    platformFeePaise?: number;
  }>;
  shopCategory?: string;
}): OrderEarningsResult {
  const { itemTotalPaise = 0, items = [], shopCategory } = params;

  if (Array.isArray(items) && items.length > 0) {
    let grossPaise = 0;
    let totalCommissionPaise = 0;

    for (const item of items) {
      const lineTotal = Math.max(0, Math.round(item.lineTotalPaise || 0));
      grossPaise += lineTotal;

      let feePercent = item.platformFeePercent;
      if (feePercent == null) {
        const catSlug =
          item.subcategorySlug ||
          item.categorySlug ||
          getCachedProductCategorySlug(item.productSlug);
        feePercent = getPlatformFeePercent(catSlug, shopCategory, item.productSlug);
      }

      const lineFee =
        item.platformFeePaise != null
          ? item.platformFeePaise
          : Math.round((lineTotal * feePercent) / 100);

      totalCommissionPaise += lineFee;
    }

    if (grossPaise <= 0 && itemTotalPaise > 0) {
      grossPaise = Math.max(0, Math.round(itemTotalPaise));
    }

    const gstPaise = Math.round((totalCommissionPaise * COMMISSION_GST_PERCENT) / 100);
    const netEarningsPaise = Math.max(0, grossPaise - totalCommissionPaise - gstPaise);
    const effectivePercent =
      grossPaise > 0 ? Number(((totalCommissionPaise / grossPaise) * 100).toFixed(2)) : DEFAULT_PLATFORM_FEE_PERCENT;

    return {
      grossPaise,
      commissionPaise: totalCommissionPaise,
      gstPaise,
      netEarningsPaise,
      effectivePercent,
    };
  }

  // Fallback when no line items are provided
  const grossPaise = Math.max(0, Math.round(itemTotalPaise));
  const feePercent = getPlatformFeePercent(undefined, shopCategory);
  const commissionPaise = Math.round((grossPaise * feePercent) / 100);
  const gstPaise = Math.round((commissionPaise * COMMISSION_GST_PERCENT) / 100);
  const netEarningsPaise = Math.max(0, grossPaise - commissionPaise - gstPaise);

  return {
    grossPaise,
    commissionPaise,
    gstPaise,
    netEarningsPaise,
    effectivePercent: feePercent,
  };
}

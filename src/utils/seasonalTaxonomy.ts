import { AppError } from './response';

export const DIWALI_SUBCATEGORIES = [
  'Diyas and Oil Lamps',
  'Decorative Lights and LED String Lights',
  'Candles',
  'Rangoli Products and Rangoli Kits',
  'Torans and Home Decorations',
  'Diwali Gift Hampers',
  'Pooja Products and Idols',
] as const;

export type DiwaliSubcategory = (typeof DIWALI_SUBCATEGORIES)[number];

export const SEASONAL_UNITS = [
  'Piece',
  'Pack',
  'Box',
  'Set',
  'Pair',
  'Kg',
  'Gram',
] as const;

export const DIYA_TYPES = [
  'Clay Diya',
  'Brass Diya',
  'Ceramic Diya',
  'Decorative Diya',
  'Electric Diya',
  'Floating Diya',
] as const;

// Prohibited firecracker and explosive keywords
export const PROHIBITED_KEYWORDS = [
  'firecracker',
  'firecrackers',
  'cracker',
  'crackers',
  'firework',
  'fireworks',
  'patakha',
  'patakhe',
  'patakhas',
  'phuljhadi',
  'fuljhadi',
  'chakri',
  'chakkari',
  'anaar',
  'anar',
  'sutli bomb',
  'atom bomb',
  'bomb',
  'gunpowder',
  'explosive',
  'explosives',
  'pyrotechnic',
  'pyrotechnics',
  'sparkler',
  'sparklers',
  'diwali rocket',
  'sky rocket',
];

/**
 * Checks whether any text contains prohibited fireworks or explosive terms.
 */
export function checkProhibitedKeywords(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of PROHIBITED_KEYWORDS) {
    const regex = new RegExp(`\\b${kw.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lower)) {
      return kw;
    }
  }
  return null;
}

export function assertNoProhibitedItems(data: Record<string, any>): void {
  const fieldsToCheck = [
    data.name,
    data.submittedProductName,
    data.brand,
    data.description,
    data.seasonalSubcategory,
    data.subCategory,
    data.customCategoryName,
    data.customSubcategoryName,
    data.customProductTypeName,
    data.submissionNote,
    JSON.stringify(data.specifications || {}),
  ];

  for (const field of fieldsToCheck) {
    if (typeof field === 'string') {
      const match = checkProhibitedKeywords(field);
      if (match) {
        throw new AppError(
          `Prohibited product violation: Firecrackers, fireworks and explosive products ("${match}") are strictly prohibited from sale and listing on ExtraHand under Indian Law.`,
          400
        );
      }
    }
  }
}

/**
 * Validates shared seasonal requirements and Diwali-specific mandatory fields.
 */
export function validateSeasonalProductInput(input: {
  name: string;
  festival?: string;
  customCategoryName?: string;
  subcategoryId?: string;
  seasonalSubcategory?: string;
  customSubcategoryName?: string;
  customProductTypeName?: string;
  description?: string;
  mrpPaise?: number;
  sellingPricePaise?: number;
  quantity?: number;
  unit?: string;
  availableFrom?: Date | string;
  availableUntil?: Date | string;
  specifications?: Record<string, any>;
  manufacturerDetails?: Record<string, any>;
  complianceDetails?: Record<string, any>;
  images?: string[];
}): void {
  // 1. Prohibited check
  assertNoProhibitedItems(input);

  // 2. Festival check
  const festival = (input.festival || '').trim().toLowerCase();
  if (!festival) {
    throw new AppError('Festival is mandatory for seasonal products', 400);
  }
  const isDiwaliFestival = festival.includes('diwali');

  // 3. Subcategory check
  const subcat = input.seasonalSubcategory?.trim();
  if (!subcat) {
    throw new AppError('Product Subcategory is mandatory for seasonal products', 400);
  }
  const matchedSubcat = isDiwaliFestival ? DIWALI_SUBCATEGORIES.find(
    (s) => s.toLowerCase() === subcat.toLowerCase()
  ) : undefined;
  if (
    isDiwaliFestival &&
    !matchedSubcat &&
    !input.customSubcategoryName?.trim() &&
    !input.subcategoryId?.trim()
  ) {
    throw new AppError(
      `Invalid seasonal subcategory. Must be one of: ${DIWALI_SUBCATEGORIES.join(', ')}`,
      400
    );
  }

  // 4. Description check
  if (!input.description || !input.description.trim()) {
    throw new AppError('Product description is mandatory', 400);
  }

  // 5. Pricing checks
  if (input.mrpPaise == null || input.mrpPaise <= 0) {
    throw new AppError('MRP is mandatory and must be greater than 0', 400);
  }
  if (input.sellingPricePaise == null || input.sellingPricePaise <= 0) {
    throw new AppError('Selling price is mandatory and must be greater than 0', 400);
  }
  if (input.sellingPricePaise > input.mrpPaise) {
    throw new AppError('Selling price cannot exceed MRP', 400);
  }

  // 6. Inventory checks
  if (input.quantity == null || input.quantity < 0) {
    throw new AppError('Available stock quantity is mandatory and must be 0 or greater', 400);
  }
  const unit = input.unit?.trim();
  if (!unit) {
    throw new AppError('Unit is mandatory for seasonal products', 400);
  }

  // 7. Specifications validation
  const specs = input.specifications || {};
  switch (matchedSubcat) {
    case 'Diyas and Oil Lamps':
      if (!specs.diyaType?.trim()) throw new AppError('Diya Type is required for Diyas and Oil Lamps', 400);
      if (!specs.material?.trim()) throw new AppError('Material is required for Diyas and Oil Lamps', 400);
      break;

    case 'Decorative Lights and LED String Lights':
      if (!specs.lightType?.trim()) throw new AppError('Light Type is required for Decorative Lights', 400);
      if (!specs.lightTechnology?.trim() && !specs.technology?.trim()) {
        throw new AppError('Light Technology (e.g. LED, Rice bulb) is required', 400);
      }
      break;

    case 'Candles':
      if (!specs.candleType?.trim()) throw new AppError('Candle Type is required for Candles', 400);
      if (!specs.waxType?.trim() && !specs.material?.trim()) {
        throw new AppError('Wax Type or Material is required for Candles', 400);
      }
      break;

    case 'Rangoli Products and Rangoli Kits':
      if (!specs.rangoliProductType?.trim()) {
        throw new AppError('Rangoli Product Type is required', 400);
      }
      break;

    case 'Torans and Home Decorations':
      if (!specs.decorationType?.trim()) {
        throw new AppError('Decoration Type is required for Torans and Home Decorations', 400);
      }
      break;

    case 'Diwali Gift Hampers':
      if (!specs.hamperType?.trim()) {
        throw new AppError('Hamper Type is required for Diwali Gift Hampers', 400);
      }
      if (!specs.includedProducts || (Array.isArray(specs.includedProducts) && specs.includedProducts.length === 0)) {
        throw new AppError('At least one included product item is required for Gift Hampers', 400);
      }
      // If food containing hamper, validate food compliance
      if (specs.containsFood) {
        const compliance = input.complianceDetails || {};
        if (!compliance.fssaiNumber && !specs.fssaiNumber) {
          throw new AppError('FSSAI License / Registration Number is required for food-containing hampers', 400);
        }
      }
      break;

    case 'Pooja Products and Idols':
      if (!specs.poojaItemType?.trim() && !specs.itemType?.trim() && !specs.idolType?.trim()) {
        throw new AppError('Item or Idol Type is required for Pooja Products and Idols', 400);
      }
      break;
  }

  // 8. Availability Dates
  if (input.availableFrom && input.availableUntil) {
    const from = new Date(input.availableFrom);
    const until = new Date(input.availableUntil);
    if (isNaN(from.getTime()) || isNaN(until.getTime())) {
      throw new AppError('Seasonal availability dates must be valid dates', 400);
    }
    if (until < from) {
      throw new AppError('Available Until date cannot be earlier than Available From date', 400);
    }
  }
}

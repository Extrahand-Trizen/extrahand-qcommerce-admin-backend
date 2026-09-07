import { NutritionInformation, ProductInformation } from '../types';
import { AppError } from './response';

const NUTRITION_KEYS = [
  'servingSize',
  'energy',
  'protein',
  'carbohydrates',
  'totalFat',
  'saturatedFat',
  'sugar',
  'sodium',
] as const satisfies ReadonlyArray<keyof NutritionInformation>;

const TEXT_FIELDS = [
  'ingredients',
  'manufacturer',
  'healthBenefits',
  'specialFeatures',
  'storageInformation',
  'usageInstructions',
  'allergens',
] as const satisfies ReadonlyArray<keyof ProductInformation>;

function trimOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function assertObject(input: unknown, label: string): Record<string, unknown> {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(`${label} must be an object`, 400);
  }
  return input as Record<string, unknown>;
}

/** Normalize a full Product Information payload (create / full replace). */
export function normalizeProductInformation(input: unknown): ProductInformation | undefined {
  const src = assertObject(input, 'productInformation');
  const out: ProductInformation = {};

  for (const field of TEXT_FIELDS) {
    const value = trimOptionalString(src[field]);
    if (value) out[field] = value;
  }

  if ('nutritionInformation' in src && src.nutritionInformation != null) {
    const nutritionSrc = assertObject(src.nutritionInformation, 'nutritionInformation');
    const nutrition: NutritionInformation = {};
    for (const key of NUTRITION_KEYS) {
      const value = trimOptionalString(nutritionSrc[key]);
      if (value) nutrition[key] = value;
    }
    if (Object.keys(nutrition).length) out.nutritionInformation = nutrition;
  }

  return Object.keys(out).length ? out : undefined;
}

/**
 * Apply a Product Information patch.
 * Only keys present in the patch are changed; omitted keys are preserved.
 * Present keys with empty strings clear that field.
 */
export function applyProductInformationPatch(
  existing: ProductInformation | null | undefined,
  input: unknown,
): ProductInformation | undefined {
  if (input == null) return undefined;

  const src = assertObject(input, 'productInformation');
  const next: ProductInformation = { ...(existing || {}) };

  for (const field of TEXT_FIELDS) {
    if (field in src) {
      const value = trimOptionalString(src[field]);
      if (value) next[field] = value;
      else delete next[field];
    }
  }

  if ('nutritionInformation' in src) {
    if (src.nutritionInformation == null) {
      delete next.nutritionInformation;
    } else {
      const nutritionSrc = assertObject(src.nutritionInformation, 'nutritionInformation');
      const nutrition: NutritionInformation = { ...(next.nutritionInformation || {}) };
      for (const key of NUTRITION_KEYS) {
        if (key in nutritionSrc) {
          const value = trimOptionalString(nutritionSrc[key]);
          if (value) nutrition[key] = value;
          else delete nutrition[key];
        }
      }
      if (Object.keys(nutrition).length) next.nutritionInformation = nutrition;
      else delete next.nutritionInformation;
    }
  }

  return Object.keys(next).length ? next : undefined;
}

/** Map MasterProduct Product Information for customer storefront PDP responses. */
export function mapStorefrontProductInformation(
  input: ProductInformation | null | undefined,
): ProductInformation | undefined {
  if (!input) return undefined;

  const out: ProductInformation = {};

  for (const field of TEXT_FIELDS) {
    const value = trimOptionalString((input as Record<string, unknown>)[field]);
    if (value) out[field] = value;
  }

  if (input.nutritionInformation) {
    const nutrition: NutritionInformation = {};
    for (const key of NUTRITION_KEYS) {
      const value = trimOptionalString(input.nutritionInformation[key]);
      if (value) nutrition[key] = value;
    }
    if (Object.keys(nutrition).length) out.nutritionInformation = nutrition;
  }

  return Object.keys(out).length ? out : undefined;
}

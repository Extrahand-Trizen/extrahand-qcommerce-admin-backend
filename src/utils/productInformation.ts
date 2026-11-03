import { NutritionInformation, ProductCustomAttribute, ProductInformation } from '../types';
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
  'manufacturerAddress',
  'healthBenefits',
  'specialFeatures',
  'storageInformation',
  'usageInstructions',
  'allergens',
  // Medical product fields
  'genericName',
  'dosageForm',
  'routeOfAdmin',
  'strength',
  'prescriptionCategory',
  'sideEffects',
  'indication',
  'marketerName',
  'countryOfOrigin',
  'disclaimer',
  'sterility',
  'useType',
  'licenceNumber',
  'regulatoryInfo',
  'safetyInfo',
  'manufacturerContactNumber',
  'manufacturerEmail',
  'importerDetails',
  'packerDetails',
  'certificationDetails',
  'certificationNumber',
  'certificationDocUrl',
  'festival',
  'seasonalSubcategory',
] as const satisfies ReadonlyArray<keyof ProductInformation>;

const STRUCTURED_FIELDS = ['specifications', 'complianceDetails'] as const satisfies ReadonlyArray<
  keyof ProductInformation
>;

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

function normalizeCustomAttributes(input: unknown): ProductCustomAttribute[] | undefined {
  if (input == null) return undefined;
  if (!Array.isArray(input)) {
    throw new AppError('customAttributes must be an array', 400);
  }
  if (input.length > 30) {
    throw new AppError('A product can have at most 30 custom attributes', 400);
  }

  const labels = new Set<string>();
  const attributes: ProductCustomAttribute[] = input.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AppError('Each custom attribute must include a name and value', 400);
    }

    const attribute = item as Record<string, unknown>;
    if (typeof attribute.label !== 'string' || typeof attribute.value !== 'string') {
      throw new AppError('Each custom attribute must include a name and value', 400);
    }
    const label = attribute.label.trim();
    const value = attribute.value.trim();
    if (!label || !value || label.length > 80 || value.length > 500) {
      throw new AppError(
        'Each custom attribute must have a name (up to 80 characters) and value (up to 500 characters)',
        400,
      );
    }
    const normalizedLabel = label.toLocaleLowerCase();
    if (labels.has(normalizedLabel)) {
      throw new AppError('Custom attribute names must be unique', 400);
    }
    labels.add(normalizedLabel);
    return { label, value };
  });

  return attributes.length ? attributes : undefined;
}

/** Normalize a full Product Information payload (create / full replace). */
export function normalizeProductInformation(input: unknown): ProductInformation | undefined {
  const src = assertObject(input, 'productInformation');
  const out: ProductInformation = {};

  for (const field of TEXT_FIELDS) {
    const value = trimOptionalString(src[field]);
    if (value) out[field] = value;
  }

  if ('coldChainRequired' in src && src.coldChainRequired !== undefined) {
    out.coldChainRequired = Boolean(src.coldChainRequired);
  }

  if ('prescriptionRequired' in src && src.prescriptionRequired !== undefined) {
    out.prescriptionRequired = Boolean(src.prescriptionRequired);
  }

  if ('customAttributes' in src) {
    const attributes = normalizeCustomAttributes(src.customAttributes);
    if (attributes) out.customAttributes = attributes;
  }

  for (const field of STRUCTURED_FIELDS) {
    if (field in src && src[field] != null) {
      const value = assertObject(src[field], field);
      if (Object.keys(value).length) out[field] = value;
    }
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

  if ('coldChainRequired' in src) {
    if (src.coldChainRequired === null || src.coldChainRequired === undefined) {
      delete next.coldChainRequired;
    } else {
      next.coldChainRequired = Boolean(src.coldChainRequired);
    }
  }

  if ('prescriptionRequired' in src) {
    if (src.prescriptionRequired === null || src.prescriptionRequired === undefined) {
      delete next.prescriptionRequired;
    } else {
      next.prescriptionRequired = Boolean(src.prescriptionRequired);
    }
  }

  if ('customAttributes' in src) {
    if (src.customAttributes == null) {
      delete next.customAttributes;
    } else {
      const attributes = normalizeCustomAttributes(src.customAttributes);
      if (attributes) next.customAttributes = attributes;
      else delete next.customAttributes;
    }
  }

  for (const field of STRUCTURED_FIELDS) {
    if (field in src) {
      if (src[field] == null) {
        delete next[field];
      } else {
        const value = assertObject(src[field], field);
        if (Object.keys(value).length) next[field] = value;
        else delete next[field];
      }
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

  if (input.coldChainRequired !== undefined) {
    out.coldChainRequired = input.coldChainRequired;
  }

  if (input.prescriptionRequired !== undefined) {
    out.prescriptionRequired = input.prescriptionRequired;
  }

  if (Array.isArray(input.customAttributes)) {
    const attributes: ProductCustomAttribute[] = [];
    const labels = new Set<string>();
    for (const item of input.customAttributes) {
      if (!item || typeof item.label !== 'string' || typeof item.value !== 'string') continue;
      const label = item.label.trim();
      const value = item.value.trim();
      const normalizedLabel = label.toLocaleLowerCase();
      if (!label || !value || label.length > 80 || value.length > 500 || labels.has(normalizedLabel)) {
        continue;
      }
      labels.add(normalizedLabel);
      attributes.push({ label, value });
    }
    if (attributes.length) out.customAttributes = attributes;
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

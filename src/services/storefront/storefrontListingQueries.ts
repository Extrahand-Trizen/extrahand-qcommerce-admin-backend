import { FilterQuery, PipelineStage, Types } from 'mongoose';
import Seller from '../../models/Seller';
import SellerListing from '../../models/SellerListing';
import SellerOnboarding from '../../models/SellerOnboarding';
import { env } from '../../config/env';
import { AppError } from '../../utils/response';
import { getOrLoad } from './storefrontCache';

export const STOREFRONT_LISTING_MATCH = {
  status: 'ACTIVE',
  reviewStatus: 'APPROVED',
} as const;

export type SellerListingInfo = {
  price: number;
  mrp?: number;
  inStock: boolean;
  purchasable: boolean;
};

export type StorefrontLocationQuery = {
  sellerId?: string;
  lat?: number;
  lng?: number;
  pinCode?: string;
  city?: string;
};

export type StorefrontSellerResolveResult = {
  sellerId: Types.ObjectId | null;
  serviceable: boolean;
  /** True when customer lat/lng, pin, city, or explicit sellerId drove resolution. */
  locationUsed: boolean;
  matchedBy: 'explicit' | 'geo' | 'pincode' | 'city' | 'default' | 'none';
  shopName?: string;
  shopCity?: string;
  distanceKm?: number;
};

const SEED_STOREFRONT_SELLER_USER_ID = 'seed-default-seller';

const LISTING_COLLECTION = () => SellerListing.collection.name;
const SELLER_COLLECTION = () => Seller.collection.name;

let cachedSeedSellerObjectId: Types.ObjectId | null | undefined;

export async function getSeedSellerObjectId(): Promise<Types.ObjectId | null> {
  if (cachedSeedSellerObjectId !== undefined) return cachedSeedSellerObjectId;
  const seedSeller = await Seller.findOne({ userId: SEED_STOREFRONT_SELLER_USER_ID })
    .select('_id')
    .lean();
  cachedSeedSellerObjectId = seedSeller?._id ?? null;
  return cachedSeedSellerObjectId;
}

export function listingInfoFromRow(listing: {
  sellingPricePaise: number;
  compareAtPricePaise?: number | null;
  availability: string;
}): SellerListingInfo {
  const inStock = listing.availability === 'AVAILABLE' || listing.availability === 'LIMITED';
  return {
    price: listing.sellingPricePaise / 100,
    mrp: listing.compareAtPricePaise != null ? listing.compareAtPricePaise / 100 : undefined,
    inStock,
    purchasable: inStock,
  };
}

/** MongoDB picks the same "best" listing as the previous in-memory merge. */
export async function aggregateBestListingsPerProduct(
  productIds: Types.ObjectId[],
  options: { excludeSellerId?: Types.ObjectId | null } = {},
): Promise<Map<string, SellerListingInfo>> {
  if (!productIds.length) return new Map();

  const match: FilterQuery<typeof SellerListing> = {
    masterProductId: { $in: productIds },
    ...STOREFRONT_LISTING_MATCH,
  };
  if (options.excludeSellerId) {
    match.sellerId = { $ne: options.excludeSellerId };
  }

  const rows = await SellerListing.aggregate<{
    _id: Types.ObjectId;
    sellingPricePaise: number;
    compareAtPricePaise?: number | null;
    availability: string;
  }>([
    { $match: match },
    {
      $addFields: {
        _inStockRank: {
          $cond: [{ $in: ['$availability', ['AVAILABLE', 'LIMITED']] }, 0, 1],
        },
      },
    },
    { $sort: { _inStockRank: 1, sellingPricePaise: 1 } },
    {
      $group: {
        _id: '$masterProductId',
        sellingPricePaise: { $first: '$sellingPricePaise' },
        compareAtPricePaise: { $first: '$compareAtPricePaise' },
        availability: { $first: '$availability' },
      },
    },
    {
      $project: {
        _id: 1,
        sellingPricePaise: 1,
        compareAtPricePaise: 1,
        availability: 1,
      },
    },
  ]);

  const listingMap = new Map<string, SellerListingInfo>();
  for (const row of rows) {
    listingMap.set(row._id.toString(), listingInfoFromRow(row));
  }
  return listingMap;
}

export async function loadPreferredSellerListingMap(
  productIds: Types.ObjectId[],
  sellerObjectId: Types.ObjectId | null,
): Promise<Map<string, SellerListingInfo>> {
  if (!productIds.length || !sellerObjectId) return new Map();

  const listings = await SellerListing.find({
    sellerId: sellerObjectId,
    masterProductId: { $in: productIds },
    ...STOREFRONT_LISTING_MATCH,
  })
    .select('masterProductId sellingPricePaise compareAtPricePaise availability')
    .lean();

  const listingMap = new Map<string, SellerListingInfo>();
  for (const listing of listings) {
    listingMap.set(listing.masterProductId.toString(), listingInfoFromRow(listing));
  }
  return listingMap;
}

export async function loadAnySellerListingMap(
  productIds: Types.ObjectId[],
): Promise<Map<string, SellerListingInfo>> {
  const seedSellerId = await getSeedSellerObjectId();
  return aggregateBestListingsPerProduct(productIds, { excludeSellerId: seedSellerId });
}

/**
 * $lookup: keep master products that have a storefront listing.
 * When `sellerId` is set, only that seller's ACTIVE+APPROVED listings count.
 */
export function listedProductLookupStage(
  sellerId?: Types.ObjectId | null,
): PipelineStage.Lookup {
  const matchExpr: Record<string, unknown> = {
    $expr: { $eq: ['$masterProductId', '$$productId'] },
    status: STOREFRONT_LISTING_MATCH.status,
    reviewStatus: STOREFRONT_LISTING_MATCH.reviewStatus,
  };
  if (sellerId) {
    matchExpr.sellerId = sellerId;
  }

  return {
    $lookup: {
      from: LISTING_COLLECTION(),
      let: { productId: '$_id' },
      pipeline: [
        { $match: matchExpr },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ],
      as: '_storefrontListing',
    },
  };
}

export function hasListedProductMatchStage(): PipelineStage.Match {
  return { $match: { '_storefrontListing.0': { $exists: true } } };
}

export async function resolveStorefrontSellerId(sellerId?: string): Promise<Types.ObjectId | null> {
  const requested = sellerId?.trim() || env.DEFAULT_STOREFRONT_SELLER_ID?.trim();
  if (requested) {
    if (!Types.ObjectId.isValid(requested)) return null;
    return new Types.ObjectId(requested);
  }

  return getOrLoad('storefront:auto-seller-id', async () => {
    const rows = await SellerListing.aggregate<{ _id: Types.ObjectId }>([
      { $match: { ...STOREFRONT_LISTING_MATCH } },
      { $group: { _id: '$sellerId', listingCount: { $sum: 1 } } },
      { $sort: { listingCount: -1 } },
      {
        $lookup: {
          from: SELLER_COLLECTION(),
          localField: '_id',
          foreignField: '_id',
          as: 'seller',
        },
      },
      { $unwind: '$seller' },
      {
        $match: {
          'seller.status': 'ACTIVE',
          'seller.userId': { $ne: SEED_STOREFRONT_SELLER_USER_ID },
        },
      },
      { $limit: 1 },
      { $project: { _id: 1 } },
    ]);

    if (rows[0]?._id) return rows[0]._id;

    const fallback = await Seller.findOne({
      status: 'ACTIVE',
      userId: { $ne: SEED_STOREFRONT_SELLER_USER_ID },
    })
      .select('_id')
      .lean();

    return fallback?._id ?? null;
  }, 60_000);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export function parseCoord(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

/**
 * Parse location query from Express. Lat and lng must be supplied together.
 * Throws AppError(400) for incomplete or out-of-range coordinates.
 */
export function parseStorefrontLocationQuery(raw: {
  sellerId?: unknown;
  lat?: unknown;
  lng?: unknown;
  pinCode?: unknown;
  city?: unknown;
}): StorefrontLocationQuery {
  const hasLat = raw.lat !== undefined && raw.lat !== null && String(raw.lat).trim() !== '';
  const hasLng = raw.lng !== undefined && raw.lng !== null && String(raw.lng).trim() !== '';

  if (hasLat !== hasLng) {
    throw new AppError('lat and lng must be supplied together', 400, {
      code: 'INVALID_COORDINATES',
    });
  }

  let lat: number | undefined;
  let lng: number | undefined;
  if (hasLat && hasLng) {
    lat = parseCoord(raw.lat);
    lng = parseCoord(raw.lng);
    if (lat == null || lng == null) {
      throw new AppError('lat and lng must be valid numbers', 400, {
        code: 'INVALID_COORDINATES',
      });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new AppError('lat/lng out of range', 400, { code: 'INVALID_COORDINATES' });
    }
  }

  return {
    sellerId: typeof raw.sellerId === 'string' ? raw.sellerId : undefined,
    lat,
    lng,
    pinCode: typeof raw.pinCode === 'string' ? raw.pinCode : undefined,
    city: typeof raw.city === 'string' ? raw.city : undefined,
  };
}

async function loadShopSnapshot(
  sellerId: Types.ObjectId,
): Promise<{ shopName?: string; shopCity?: string }> {
  const [seller, onboarding] = await Promise.all([
    Seller.findById(sellerId).select('fullName').lean(),
    SellerOnboarding.findOne({ sellerId }).select('shopName city').lean(),
  ]);
  return {
    shopName: onboarding?.shopName?.trim() || seller?.fullName?.trim() || 'Grocery store',
    shopCity: onboarding?.city?.trim() || undefined,
  };
}

async function withShopFields(
  base: Omit<StorefrontSellerResolveResult, 'shopName' | 'shopCity'> & {
    shopName?: string;
    shopCity?: string;
  },
): Promise<StorefrontSellerResolveResult> {
  if (!base.sellerId || !base.serviceable) {
    return {
      ...base,
      locationUsed: base.locationUsed,
    };
  }
  if (base.shopName) return base as StorefrontSellerResolveResult;
  const shop = await loadShopSnapshot(base.sellerId);
  return { ...base, ...shop };
}

/**
 * Validate an explicit sellerId is ACTIVE + APPROVED.
 * When customer coords are present, also require within STOREFRONT_SERVICE_RADIUS_KM.
 *
 * Note: store OPEN/CLOSED (SellerStoreSettings) is intentionally NOT checked here —
 * storefront resolution stays independent of seller-app open/close toggles for this release.
 */
async function resolveExplicitSeller(
  sellerIdStr: string,
  lat?: number,
  lng?: number,
): Promise<StorefrontSellerResolveResult> {
  if (!Types.ObjectId.isValid(sellerIdStr)) {
    return {
      sellerId: null,
      serviceable: false,
      locationUsed: true,
      matchedBy: 'none',
    };
  }

  const sellerId = new Types.ObjectId(sellerIdStr);
  const [seller, onboarding] = await Promise.all([
    Seller.findOne({
      _id: sellerId,
      status: 'ACTIVE',
      userId: { $ne: SEED_STOREFRONT_SELLER_USER_ID },
    })
      .select('_id fullName')
      .lean(),
    SellerOnboarding.findOne({ sellerId, status: 'APPROVED' })
      .select('shopName city latitude longitude')
      .lean(),
  ]);

  if (!seller || !onboarding) {
    return {
      sellerId: null,
      serviceable: false,
      locationUsed: true,
      matchedBy: 'none',
    };
  }

  let distanceKm: number | undefined;
  if (lat != null && lng != null) {
    if (typeof onboarding.latitude !== 'number' || typeof onboarding.longitude !== 'number') {
      return {
        sellerId: null,
        serviceable: false,
        locationUsed: true,
        matchedBy: 'none',
      };
    }
    const radiusKm = Math.max(1, env.STOREFRONT_SERVICE_RADIUS_KM || 15);
    distanceKm = haversineKm(lat, lng, onboarding.latitude, onboarding.longitude);
    if (distanceKm > radiusKm) {
      return {
        sellerId: null,
        serviceable: false,
        locationUsed: true,
        matchedBy: 'none',
        distanceKm: Math.round(distanceKm * 10) / 10,
      };
    }
  }

  return {
    sellerId,
    serviceable: true,
    locationUsed: true,
    matchedBy: 'explicit',
    shopName: onboarding.shopName?.trim() || seller.fullName?.trim() || 'Grocery store',
    shopCity: onboarding.city?.trim() || undefined,
    distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : undefined,
  };
}

/**
 * Pick a storefront seller for the customer location.
 * Explicit sellerId wins when valid (and in-radius when coords given).
 * With lat/lng, only nearby shops are serviceable — never a distant fallback.
 * storeStatus OPEN/CLOSED is not applied (see resolveExplicitSeller note).
 */
export async function resolveStorefrontSellerForLocation(
  query: StorefrontLocationQuery = {},
): Promise<StorefrontSellerResolveResult> {
  const lat = parseCoord(query.lat);
  const lng = parseCoord(query.lng);
  const pinCode = query.pinCode?.trim();
  const city = query.city?.trim();
  const explicit = query.sellerId?.trim();

  if (explicit) {
    return resolveExplicitSeller(explicit, lat, lng);
  }

  const hasCoords = lat != null && lng != null;
  const hasLocationHint = hasCoords || Boolean(pinCode) || Boolean(city);

  if (hasLocationHint) {
    const onboardings = await SellerOnboarding.find({ status: 'APPROVED' })
      .select('sellerId latitude longitude city pincode shopName')
      .lean();

    const sellerIds = onboardings.map((row) => row.sellerId);
    const activeSellers = sellerIds.length
      ? await Seller.find({
          _id: { $in: sellerIds },
          status: 'ACTIVE',
          userId: { $ne: SEED_STOREFRONT_SELLER_USER_ID },
        })
          .select('_id fullName')
          .lean()
      : [];
    const activeById = new Map(activeSellers.map((s) => [s._id.toString(), s]));
    const activeOnboardings = onboardings.filter((row) =>
      activeById.has(row.sellerId.toString()),
    );
    const hasGeoCatalog = activeOnboardings.some(
      (row) => typeof row.latitude === 'number' && typeof row.longitude === 'number',
    );

    if (hasCoords && hasGeoCatalog) {
      const radiusKm = Math.max(1, env.STOREFRONT_SERVICE_RADIUS_KM || 15);
      let best: {
        sellerId: Types.ObjectId;
        distanceKm: number;
        shopName?: string;
        shopCity?: string;
      } | null = null;

      for (const row of activeOnboardings) {
        if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') continue;
        const distanceKm = haversineKm(lat, lng, row.latitude, row.longitude);
        if (distanceKm > radiusKm) continue;
        if (!best || distanceKm < best.distanceKm) {
          const seller = activeById.get(row.sellerId.toString());
          best = {
            sellerId: row.sellerId,
            distanceKm,
            shopName: row.shopName?.trim() || seller?.fullName?.trim() || 'Grocery store',
            shopCity: row.city?.trim() || undefined,
          };
        }
      }

      if (best) {
        return {
          sellerId: best.sellerId,
          serviceable: true,
          locationUsed: true,
          matchedBy: 'geo',
          shopName: best.shopName,
          shopCity: best.shopCity,
          distanceKm: Math.round(best.distanceKm * 10) / 10,
        };
      }
      return {
        sellerId: null,
        serviceable: false,
        locationUsed: true,
        matchedBy: 'none',
      };
    }

    // Coords provided but no geo catalog — do not fall back to a distant seller.
    if (hasCoords && !hasGeoCatalog) {
      return {
        sellerId: null,
        serviceable: false,
        locationUsed: true,
        matchedBy: 'none',
      };
    }

    if (pinCode) {
      const pinMatch = activeOnboardings.find(
        (row) => String(row.pincode || '').trim() === pinCode,
      );
      if (pinMatch) {
        return withShopFields({
          sellerId: pinMatch.sellerId,
          serviceable: true,
          locationUsed: true,
          matchedBy: 'pincode',
          shopName: pinMatch.shopName?.trim(),
          shopCity: pinMatch.city?.trim(),
        });
      }
    }

    if (city) {
      const cityNeedle = city.toLowerCase();
      const cityMatch = activeOnboardings.find(
        (row) => String(row.city || '').trim().toLowerCase() === cityNeedle,
      );
      if (cityMatch) {
        return withShopFields({
          sellerId: cityMatch.sellerId,
          serviceable: true,
          locationUsed: true,
          matchedBy: 'city',
          shopName: cityMatch.shopName?.trim(),
          shopCity: cityMatch.city?.trim(),
        });
      }
    }

    if (!hasGeoCatalog && activeOnboardings.length === 0) {
      const fallback = await resolveStorefrontSellerId();
      return withShopFields({
        sellerId: fallback,
        serviceable: Boolean(fallback),
        locationUsed: true,
        matchedBy: fallback ? 'default' : 'none',
      });
    }

    if (activeOnboardings.length > 0 && (pinCode || city || hasGeoCatalog)) {
      return {
        sellerId: null,
        serviceable: false,
        locationUsed: true,
        matchedBy: 'none',
      };
    }

    const fallback = await resolveStorefrontSellerId();
    return withShopFields({
      sellerId: fallback,
      serviceable: Boolean(fallback),
      locationUsed: true,
      matchedBy: fallback ? 'default' : 'none',
    });
  }

  // No customer location — legacy default / auto-pick.
  const fallback = await resolveStorefrontSellerId();
  return withShopFields({
    sellerId: fallback,
    serviceable: true,
    locationUsed: false,
    matchedBy: 'default',
  });
}

export function storefrontStoreDto(resolved: StorefrontSellerResolveResult): {
  sellerId: string;
  shopName: string;
  shopCity?: string;
  distanceKm?: number;
} | null {
  if (!resolved.serviceable || !resolved.sellerId) return null;
  return {
    sellerId: resolved.sellerId.toString(),
    shopName: resolved.shopName || 'Grocery store',
    ...(resolved.shopCity ? { shopCity: resolved.shopCity } : {}),
    ...(resolved.distanceKm != null ? { distanceKm: resolved.distanceKm } : {}),
  };
}

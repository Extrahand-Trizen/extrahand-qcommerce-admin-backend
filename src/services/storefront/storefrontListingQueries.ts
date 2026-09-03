import { FilterQuery, PipelineStage, Types } from 'mongoose';
import Seller from '../../models/Seller';
import SellerListing from '../../models/SellerListing';
import { env } from '../../config/env';
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

/** $lookup stage: keep only master products that have at least one storefront listing. */
export function listedProductLookupStage(): PipelineStage.Lookup {
  return {
    $lookup: {
      from: LISTING_COLLECTION(),
      let: { productId: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ['$masterProductId', '$$productId'] },
            status: STOREFRONT_LISTING_MATCH.status,
            reviewStatus: STOREFRONT_LISTING_MATCH.reviewStatus,
          },
        },
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

import { Types } from 'mongoose';
import Promotion, { IPromotion } from '../models/Promotion';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerListing from '../models/SellerListing';
import { promotionStatus, PromotionStatusDTO } from './PromotionService';
import { resolvePublicAssetUrl } from '../utils/media';

export interface AdminPromotionProductDTO {
  masterProductId: string;
  name: string;
  slug: string;
  originalPricePaise?: number;
  discountedPricePaise?: number;
  discountAmountPaise?: number;
  discountPercent?: number;
}

export interface AdminPromotionDTO {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerMobile?: string;
  sellerEmail?: string;
  storeName: string;
  storeCity?: string;
  offerType: 'COUPON' | 'PRICE_DROP';
  trigger: 'CODE' | 'AUTOMATIC';
  code?: string;
  description?: string;
  appliesTo: 'ORDER' | 'PRODUCTS';
  discountType: 'PERCENT' | 'FLAT';
  discountValue: number;
  formattedDiscount: string;
  minOrderPaise?: number;
  maxDiscountPaise?: number;
  usageLimit?: number;
  perCustomerLimit?: number;
  usedCount: number;
  totalDiscountGivenPaise: number;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  status: PromotionStatusDTO;
  products: AdminPromotionProductDTO[];
}

export interface AdminPromotionListQuery {
  page?: number;
  limit?: number;
  search?: string;
  offerType?: 'COUPON' | 'PRICE_DROP' | 'ALL';
  status?: string;
  sellerId?: string;
}

export class AdminPromotionService {
  static async listPromotions(query: AdminPromotionListQuery) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const filter: Record<string, unknown> = {};

    if (query.offerType === 'COUPON') {
      filter.trigger = 'CODE';
    } else if (query.offerType === 'PRICE_DROP') {
      filter.trigger = 'AUTOMATIC';
    }

    if (query.sellerId && Types.ObjectId.isValid(query.sellerId)) {
      filter.sellerId = new Types.ObjectId(query.sellerId);
    }

    // Search by text if provided
    if (query.search && query.search.trim()) {
      const searchRegex = new RegExp(query.search.trim(), 'i');
      const matchingSellers = await Seller.find({
        $or: [
          { fullName: searchRegex },
          { mobileNumber: searchRegex },
          { email: searchRegex },
        ],
      }).select('_id').lean();

      const matchingOnboardings = await SellerOnboarding.find({
        $or: [{ shopName: searchRegex }, { city: searchRegex }],
      }).select('sellerId').lean();

      const matchingSellerIds = [
        ...matchingSellers.map((s) => s._id),
        ...matchingOnboardings.map((o) => o.sellerId),
      ];

      filter.$or = [
        { code: searchRegex },
        { description: searchRegex },
        { 'productSnapshots.name': searchRegex },
        { sellerId: { $in: matchingSellerIds } },
      ];
    }

    const allPromos = await Promotion.find(filter).sort({ createdAt: -1 }).lean();

    // Map and filter by status if requested
    let filtered = allPromos.map((p) => ({
      promo: p,
      computedStatus: promotionStatus(p),
    }));

    if (query.status && query.status.toUpperCase() !== 'ALL') {
      const targetStatus = query.status.toLowerCase();
      filtered = filtered.filter((item) => item.computedStatus === targetStatus);
    }

    const total = filtered.length;
    const paginated = filtered.slice((page - 1) * limit, page * limit);

    // Batch resolve sellers, onboarding shops, and listings
    const sellerIds = [...new Set(paginated.map((item) => item.promo.sellerId.toString()))];
    const sellerObjectIds = sellerIds.map((id) => new Types.ObjectId(id));

    const [sellers, onboardings] = await Promise.all([
      Seller.find({ _id: { $in: sellerObjectIds } }).lean(),
      SellerOnboarding.find({ sellerId: { $in: sellerObjectIds } }).lean(),
    ]);

    const sellerMap = new Map(sellers.map((s) => [s._id.toString(), s]));
    const onboardingMap = new Map(onboardings.map((o) => [o.sellerId.toString(), o]));

    // Batch resolve product listings for price calculation
    const allProductIds = [
      ...new Set(
        paginated.flatMap((item) =>
          (item.promo.productMasterIds || []).map((id) => id.toString())
        )
      ),
    ];

    let listingsMap = new Map<string, { sellingPricePaise: number; mrpPaise?: number }>();
    if (allProductIds.length > 0) {
      const listings = await SellerListing.find({
        sellerId: { $in: sellerObjectIds },
        masterProductId: { $in: allProductIds.map((id) => new Types.ObjectId(id)) },
      })
        .select('sellerId masterProductId sellingPricePaise compareAtPricePaise')
        .lean();

      listings.forEach((l) => {
        const key = `${l.sellerId.toString()}_${l.masterProductId.toString()}`;
        listingsMap.set(key, {
          sellingPricePaise: l.sellingPricePaise,
          mrpPaise: (l as any).compareAtPricePaise || l.sellingPricePaise,
        });
      });
    }

    const items: AdminPromotionDTO[] = paginated.map(({ promo, computedStatus }) => {
      const sellerIdStr = promo.sellerId.toString();
      const s = sellerMap.get(sellerIdStr);
      const o = onboardingMap.get(sellerIdStr);

      const sellerName = s?.fullName || o?.fullName || 'Seller';
      const storeName = o?.shopName || 'Store';

      const offerType: 'COUPON' | 'PRICE_DROP' = promo.trigger === 'AUTOMATIC' ? 'PRICE_DROP' : 'COUPON';
      const discountType = promo.type === 'PERCENT' ? 'PERCENT' : 'FLAT';
      const formattedDiscount =
        discountType === 'PERCENT'
          ? `${promo.value}% OFF`
          : `₹${(promo.value / 100).toFixed(2)} OFF`;

      const productsDTO: AdminPromotionProductDTO[] = (promo.productSnapshots || []).map((snap) => {
        const prodIdStr = snap.masterProductId.toString();
        const listingKey = `${sellerIdStr}_${prodIdStr}`;
        const listing = listingsMap.get(listingKey);

        let origPrice = listing?.sellingPricePaise || 0;
        let discPrice = origPrice;
        let discAmt = 0;
        let discPct = 0;

        if (origPrice > 0) {
          if (discountType === 'PERCENT') {
            discPct = promo.value;
            discAmt = Math.round((origPrice * promo.value) / 100);
            discPrice = Math.max(0, origPrice - discAmt);
          } else {
            discAmt = promo.value;
            discPrice = Math.max(0, origPrice - promo.value);
            discPct = Math.round((discAmt / origPrice) * 100);
          }
        }

        return {
          masterProductId: prodIdStr,
          name: snap.name,
          slug: snap.slug,
          originalPricePaise: origPrice,
          discountedPricePaise: discPrice,
          discountAmountPaise: discAmt,
          discountPercent: discPct,
        };
      });

      return {
        id: promo._id.toString(),
        sellerId: sellerIdStr,
        sellerName,
        sellerMobile: s?.mobileNumber || o?.mobileNumber,
        sellerEmail: s?.email || o?.email,
        storeName,
        storeCity: o?.city,
        offerType,
        trigger: promo.trigger === 'AUTOMATIC' ? 'AUTOMATIC' : 'CODE',
        code: promo.code,
        description: promo.description,
        appliesTo: promo.appliesTo === 'PRODUCTS' ? 'PRODUCTS' : 'ORDER',
        discountType,
        discountValue: promo.value,
        formattedDiscount,
        minOrderPaise: promo.minOrderPaise,
        maxDiscountPaise: promo.maxDiscountPaise,
        usageLimit: promo.usageLimit,
        perCustomerLimit: promo.perCustomerLimit,
        usedCount: promo.usedCount,
        totalDiscountGivenPaise: promo.totalDiscountGivenPaise,
        startsAt: new Date(promo.startsAt).toISOString(),
        endsAt: new Date(promo.endsAt).toISOString(),
        createdAt: new Date((promo as any).createdAt).toISOString(),
        status: computedStatus,
        products: productsDTO,
      };
    });

    // Summary counters
    const activeCount = allPromos.filter((p) => promotionStatus(p) === 'active').length;
    const couponCount = allPromos.filter((p) => p.trigger === 'CODE').length;
    const priceDropCount = allPromos.filter((p) => p.trigger === 'AUTOMATIC').length;
    const totalDiscountGivenPaise = allPromos.reduce((acc, p) => acc + (p.totalDiscountGivenPaise || 0), 0);

    return {
      promotions: items,
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      summary: {
        totalOffers: allPromos.length,
        activeOffers: activeCount,
        activeCount,
        couponsCount: couponCount,
        couponCount,
        priceDropsCount: priceDropCount,
        priceDropCount,
        totalDiscountGivenPaise,
      },
    };
  }

  static async getPromotionById(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new Error('Invalid promotion ID');
    const p = await Promotion.findById(id).lean();
    if (!p) throw new Error('Promotion not found');

    const result = await this.listPromotions({ page: 1, limit: 1 });
    const singleResult = await Promotion.findById(id).lean();
    if (!singleResult) throw new Error('Promotion not found');

    const sellerIdStr = singleResult.sellerId.toString();
    const [seller, onboarding] = await Promise.all([
      Seller.findById(sellerIdStr).lean(),
      SellerOnboarding.findOne({ sellerId: sellerIdStr }).lean(),
    ]);

    const computedStatus = promotionStatus(singleResult);
    const offerType: 'COUPON' | 'PRICE_DROP' = singleResult.trigger === 'AUTOMATIC' ? 'PRICE_DROP' : 'COUPON';
    const discountType = singleResult.type === 'PERCENT' ? 'PERCENT' : 'FLAT';
    const formattedDiscount =
      discountType === 'PERCENT'
        ? `${singleResult.value}% OFF`
        : `₹${(singleResult.value / 100).toFixed(2)} OFF`;

    return {
      id: singleResult._id.toString(),
      sellerId: sellerIdStr,
      sellerName: seller?.fullName || onboarding?.fullName || 'Seller',
      sellerMobile: seller?.mobileNumber || onboarding?.mobileNumber,
      sellerEmail: seller?.email || onboarding?.email,
      storeName: onboarding?.shopName || 'Store',
      storeCity: onboarding?.city,
      offerType,
      trigger: singleResult.trigger === 'AUTOMATIC' ? 'AUTOMATIC' : 'CODE',
      code: singleResult.code,
      description: singleResult.description,
      appliesTo: singleResult.appliesTo === 'PRODUCTS' ? 'PRODUCTS' : 'ORDER',
      discountType,
      discountValue: singleResult.value,
      formattedDiscount,
      minOrderPaise: singleResult.minOrderPaise,
      maxDiscountPaise: singleResult.maxDiscountPaise,
      usageLimit: singleResult.usageLimit,
      perCustomerLimit: singleResult.perCustomerLimit,
      usedCount: singleResult.usedCount,
      totalDiscountGivenPaise: singleResult.totalDiscountGivenPaise,
      startsAt: new Date(singleResult.startsAt).toISOString(),
      endsAt: new Date(singleResult.endsAt).toISOString(),
      createdAt: new Date((singleResult as any).createdAt).toISOString(),
      status: computedStatus,
      products: singleResult.productSnapshots || [],
    };
  }
}

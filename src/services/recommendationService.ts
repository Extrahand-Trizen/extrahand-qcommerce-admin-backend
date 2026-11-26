import '../models/register';
import mongoose, { Types } from 'mongoose';
import {
  RecommendationGroup,
  MasterProduct,
  ProductImage,
  SellerListing,
  Category,
  Subcategory,
} from '../models';
import { GroupMode, IRecommendationGroup } from '../models/RecommendationGroup';

export interface BulkAddPayload {
  groupIds?: string[];
  productIds?: string[];
  excludedProductIds?: string[];
  pricingRule?: {
    type: 'MRP' | 'DISCOUNT_PERCENT';
    percent?: number;
  };
  defaultStock?: number;
}

export class RecommendationService {
  /**
   * Builds the query for products belonging to a dynamic category pack.
   * If specific subcategories are defined in matchingOnboardingSubcategories,
   * the query filters products to only those subcategories.
   * If matchingOnboardingSubcategories is empty or not provided, all products
   * in the category are included.
   */
  private static async buildDynamicCategoryProductQuery(
    catId: any,
    subcategories?: string[],
    excludedProductIds?: any[]
  ): Promise<any> {
    const categoryObjectId = (catId as any)?._id || catId;
    const query: any = {
      categoryId: categoryObjectId,
      status: 'ACTIVE',
    };

    if (subcategories && subcategories.length > 0) {
      const cleanSubcats = subcategories.map((s) => s.trim()).filter(Boolean);
      if (cleanSubcats.length > 0) {
        const escaped = cleanSubcats.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const subcats = await Subcategory.find({
          name: { $in: escaped.map((e) => new RegExp(`^${e}$`, 'i')) },
          categoryId: categoryObjectId,
          status: 'ACTIVE',
        })
          .select('_id')
          .lean();

        const subcatIds = subcats.map((s) => s._id);
        query.subcategoryId = { $in: subcatIds };
      }
    }

    const excluded = (excludedProductIds || []).map((id: any) => id.toString());
    if (excluded.length > 0) {
      query._id = { $nin: excluded };
    }

    return query;
  }

  /**
   * Retrieves all active recommendation groups for a given store vertical,
   * dynamically computing product counts and sample previews.
   */
  static async getGroupsForVertical(
    vertical: string,
    subcategoriesFilter?: string[]
  ): Promise<any[]> {
    const vUpper = vertical.toUpperCase();

    const groups = await RecommendationGroup.find({
      vertical: vUpper,
      status: 'ACTIVE',
    })
      .sort({ displayOrder: 1, createdAt: -1 })
      .populate('sourceCategoryId', 'name slug')
      .lean();

    const result = [];

    for (const group of groups) {
      let productCount = 0;
      let sampleProducts: any[] = [];
      const excludedIds = (group.excludedProductIds || []).map((id: any) =>
        id.toString()
      );

      if (group.mode === GroupMode.CATEGORY_DYNAMIC && group.sourceCategoryId) {
        const catId = (group.sourceCategoryId as any)._id || group.sourceCategoryId;

        const query = await RecommendationService.buildDynamicCategoryProductQuery(
          catId,
          group.matchingOnboardingSubcategories,
          excludedIds
        );

        productCount = await MasterProduct.countDocuments(query);

        if (productCount > 0) {
          sampleProducts = await MasterProduct.find(query)
            .select('_id name brand sellingPricePaise categoryId subcategoryId')
            .limit(4)
            .lean();
        }
      } else if (group.mode === GroupMode.MANUAL_CURATED) {
        if (group.includedProductIds?.length) {
          const query: any = {
            _id: { $in: group.includedProductIds },
            status: 'ACTIVE',
          };
          if (excludedIds.length > 0) {
            query._id = { $in: group.includedProductIds, $nin: excludedIds };
          }
          productCount = await MasterProduct.countDocuments(query);
          if (productCount > 0) {
            sampleProducts = await MasterProduct.find(query)
              .select('_id name brand sellingPricePaise categoryId subcategoryId')
              .limit(4)
              .lean();
          }
        } else if (group.matchingOnboardingSubcategories?.length) {
          const catId = (group.sourceCategoryId as any)?._id || group.sourceCategoryId;
          const subcats = await Subcategory.find({
            name: { $in: group.matchingOnboardingSubcategories },
            ...(catId ? { categoryId: catId } : {}),
            status: 'ACTIVE',
          }).select('_id').lean();
          const subcatIds = subcats.map((s) => s._id);

          if (subcatIds.length > 0) {
            const query: any = {
              subcategoryId: { $in: subcatIds },
              status: 'ACTIVE',
            };
            if (excludedIds.length > 0) {
              query._id = { $nin: excludedIds };
            }
            productCount = await MasterProduct.countDocuments(query);
            if (productCount > 0) {
              sampleProducts = await MasterProduct.find(query)
                .select('_id name brand sellingPricePaise categoryId subcategoryId')
                .limit(4)
                .lean();
            }
          }
        }
      }

      // Hide groups that have 0 active products
      if (productCount === 0) {
        continue;
      }

      // Fetch primary images for sample preview products
      if (sampleProducts.length > 0) {
        const productIds = sampleProducts.map((p) => p._id);
        const images = await ProductImage.find({
          masterProductId: { $in: productIds },
          isPrimary: true,
        })
          .select('masterProductId imageUrl thumbnailUrl')
          .lean();

        const imageMap = new Map<string, string>();
        for (const img of images) {
          imageMap.set(
            img.masterProductId.toString(),
            img.thumbnailUrl || img.imageUrl
          );
        }

        sampleProducts = sampleProducts.map((p) => ({
          ...p,
          imageUrl: imageMap.get(p._id.toString()) || null,
        }));
      }

      // Match score if subcategories provided in seller onboarding
      let isRecommendedMatch = false;
      if (
        subcategoriesFilter &&
        subcategoriesFilter.length > 0 &&
        group.matchingOnboardingSubcategories &&
        group.matchingOnboardingSubcategories.length > 0
      ) {
        const filterSet = new Set(
          subcategoriesFilter.map((s) => s.toLowerCase().trim())
        );
        isRecommendedMatch = group.matchingOnboardingSubcategories.some((s: string) =>
          filterSet.has(s.toLowerCase().trim())
        );
      }

      result.push({
        _id: group._id,
        name: group.name,
        code: group.code,
        description: group.description,
        vertical: group.vertical,
        mode: group.mode,
        badgeText: group.badgeText || null,
        displayOrder: group.displayOrder,
        productCount,
        sampleProducts,
        isRecommendedMatch,
        sourceCategory: group.sourceCategoryId || null,
        matchingOnboardingSubcategories: group.matchingOnboardingSubcategories || [],
      });
    }

    return result;
  }

  /**
   * Fetches paginated eligible active products for a specific group (used in the Preview sheet).
   */
  static async getGroupProducts(
    groupId: string,
    page = 1,
    limit = 50
  ): Promise<{ products: any[]; subcategories?: string[]; total: number; page: number; totalPages: number }> {
    const group = await RecommendationGroup.findById(groupId).lean();
    if (!group) {
      throw new Error('Recommendation group not found');
    }

    let query: any = { status: 'ACTIVE' };
    const excludedIds = (group.excludedProductIds || []).map((id: any) => id.toString());

    if (group.mode === GroupMode.CATEGORY_DYNAMIC && group.sourceCategoryId) {
      const catId = (group.sourceCategoryId as any)?._id || group.sourceCategoryId;
      query = await RecommendationService.buildDynamicCategoryProductQuery(
        catId,
        group.matchingOnboardingSubcategories,
        excludedIds
      );
    } else if (group.mode === GroupMode.MANUAL_CURATED) {
      if (group.includedProductIds?.length) {
        query._id = { $in: group.includedProductIds };
      } else if (group.matchingOnboardingSubcategories?.length) {
        const catId = (group.sourceCategoryId as any)?._id || group.sourceCategoryId;
        const subcats = await Subcategory.find({
          name: { $in: group.matchingOnboardingSubcategories },
          ...(catId ? { categoryId: catId } : {}),
          status: 'ACTIVE',
        }).select('_id').lean();
        const subcatIds = subcats.map((s) => s._id);
        query.subcategoryId = { $in: subcatIds };
      } else {
        return { products: [], total: 0, page, totalPages: 0 };
      }
    } else {
      return { products: [], total: 0, page, totalPages: 0 };
    }

    const skip = (page - 1) * limit;
    const [total, products] = await Promise.all([
      MasterProduct.countDocuments(query),
      MasterProduct.find(query)
        .select('_id name brand sku sellingPricePaise categoryId subcategoryId')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    if (products.length > 0) {
      const productIds = products.map((p) => p._id);
      const subcatIds = products
        .map((p) => p.subcategoryId)
        .filter(Boolean);

      const [images, subcats] = await Promise.all([
        ProductImage.find({
          masterProductId: { $in: productIds },
          isPrimary: true,
        })
          .select('masterProductId imageUrl thumbnailUrl')
          .lean(),
        subcatIds.length > 0
          ? Subcategory.find({ _id: { $in: subcatIds } })
              .select('_id name')
              .lean()
          : Promise.resolve([]),
      ]);

      const imageMap = new Map<string, string>();
      for (const img of images) {
        imageMap.set(
          img.masterProductId.toString(),
          img.thumbnailUrl || img.imageUrl
        );
      }

      const subcatMap = new Map<string, string>();
      for (const sub of subcats) {
        subcatMap.set(sub._id.toString(), sub.name);
      }

      for (const prod of products) {
        (prod as any).imageUrl = imageMap.get(prod._id.toString()) || null;
        const sId = prod.subcategoryId ? prod.subcategoryId.toString() : '';
        (prod as any).subcategoryName = subcatMap.get(sId) || 'General Products';
      }
    }

    const subcatList = products.map((p: any) => p.subcategoryName).filter(Boolean);
    const uniqueSubcategories = Array.from(new Set(subcatList));

    return {
      products,
      subcategories: uniqueSubcategories,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Atomic batch insertion of recommended products into sellerlistings.
   */
  static async bulkAddProductsToSeller(
    sellerId: string,
    payload: BulkAddPayload
  ): Promise<{ addedCount: number; skippedCount: number; totalRequested: number }> {
    const sellerObjectId = new Types.ObjectId(sellerId);
    const targetProductIdsSet = new Set<string>();

    const userExcludedSet = new Set<string>(
      (payload.excludedProductIds || []).map((id) => id.toString())
    );

    // 1. Resolve products from groupIds
    if (payload.groupIds && payload.groupIds.length > 0) {
      const groups = await RecommendationGroup.find({
        _id: { $in: payload.groupIds },
        status: 'ACTIVE',
      }).lean();

      for (const g of groups) {
        const groupExcluded = new Set(
          (g.excludedProductIds || []).map((id: any) => id.toString())
        );

        if (g.mode === GroupMode.CATEGORY_DYNAMIC && g.sourceCategoryId) {
          const catId = (g.sourceCategoryId as any)?._id || g.sourceCategoryId;
          const query = await RecommendationService.buildDynamicCategoryProductQuery(
            catId,
            g.matchingOnboardingSubcategories,
            Array.from(groupExcluded)
          );
          const prods = await MasterProduct.find(query)
            .select('_id')
            .lean();

          for (const p of prods) {
            const pId = p._id.toString();
            if (!userExcludedSet.has(pId)) {
              targetProductIdsSet.add(pId);
            }
          }
        } else if (g.mode === GroupMode.MANUAL_CURATED) {
          if (g.includedProductIds && g.includedProductIds.length > 0) {
            for (const pIdObj of g.includedProductIds) {
              const pId = pIdObj.toString();
              if (!userExcludedSet.has(pId)) {
                targetProductIdsSet.add(pId);
              }
            }
          } else if (g.matchingOnboardingSubcategories && g.matchingOnboardingSubcategories.length > 0) {
            const catId = (g.sourceCategoryId as any)?._id || g.sourceCategoryId;
            const subcats = await Subcategory.find({
              name: { $in: g.matchingOnboardingSubcategories },
              ...(catId ? { categoryId: catId } : {}),
              status: 'ACTIVE',
            }).select('_id').lean();
            const subcatIds = subcats.map((s) => s._id);

            if (subcatIds.length > 0) {
              const prods = await MasterProduct.find({
                subcategoryId: { $in: subcatIds },
                status: 'ACTIVE',
              }).select('_id').lean();

              for (const p of prods) {
                const pId = p._id.toString();
                if (!groupExcluded.has(pId) && !userExcludedSet.has(pId)) {
                  targetProductIdsSet.add(pId);
                }
              }
            }
          }
        }
      }
    }

    // 2. Add explicit productIds if provided
    if (payload.productIds && payload.productIds.length > 0) {
      for (const pId of payload.productIds) {
        if (!userExcludedSet.has(pId.toString())) {
          targetProductIdsSet.add(pId.toString());
        }
      }
    }

    const totalRequested = targetProductIdsSet.size;
    if (totalRequested === 0) {
      return { addedCount: 0, skippedCount: 0, totalRequested: 0 };
    }

    const uniqueProductIds = Array.from(targetProductIdsSet).map(
      (id) => new Types.ObjectId(id)
    );

    // 3. Find existing listings for this seller to prevent duplicates
    const existingListings = await SellerListing.find({
      sellerId: sellerObjectId,
      masterProductId: { $in: uniqueProductIds },
    })
      .select('masterProductId')
      .lean();

    const alreadyListedSet = new Set(
      existingListings.map((l) => l.masterProductId.toString())
    );

    const eligibleProductIds = uniqueProductIds.filter(
      (id) => !alreadyListedSet.has(id.toString())
    );

    if (eligibleProductIds.length === 0) {
      return {
        addedCount: 0,
        skippedCount: totalRequested,
        totalRequested,
      };
    }

    // 4. Fetch Master Products for price and details
    const masterProducts = await MasterProduct.find({
      _id: { $in: eligibleProductIds },
      status: 'ACTIVE',
    }).lean();

    const defaultStock = payload.defaultStock && payload.defaultStock > 0 ? payload.defaultStock : 10;
    const discountPercent =
      payload.pricingRule?.type === 'DISCOUNT_PERCENT' &&
      payload.pricingRule.percent &&
      payload.pricingRule.percent > 0
        ? Math.min(payload.pricingRule.percent, 90)
        : 0;

    const bulkOps = masterProducts.map((mp) => {
      const mrpPaise = mp.sellingPricePaise || 0;
      let sellingPricePaise = mrpPaise;

      if (discountPercent > 0 && mrpPaise > 0) {
        sellingPricePaise = Math.round(mrpPaise * (1 - discountPercent / 100));
      }

      return {
        insertOne: {
          document: {
            sellerId: sellerObjectId,
            masterProductId: mp._id,
            sellerSku: mp.sku || `SKU-${mp._id.toString().substring(18)}`,
            sellingPricePaise,
            compareAtPricePaise: mrpPaise > 0 ? mrpPaise : undefined,
            status: 'ACTIVE',
            availability: 'AVAILABLE',
            reviewStatus: 'UNDER_REVIEW',
            stock: defaultStock,
            reserved: 0,
            available: defaultStock,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      };
    });

    if (bulkOps.length > 0) {
      await SellerListing.bulkWrite(bulkOps as any, { ordered: false });
    }

    return {
      addedCount: bulkOps.length,
      skippedCount: totalRequested - bulkOps.length,
      totalRequested,
    };
  }

  // --- Admin CRUD Operations ---

  static async getGroupById(id: string): Promise<any | null> {
    return await RecommendationGroup.findById(id).populate('sourceCategoryId', 'name slug').lean();
  }

  static async listAdminGroups(queryFilter: any = {}): Promise<{
    items: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const filter: any = {};
    if (queryFilter.vertical && queryFilter.vertical !== 'all') {
      filter.vertical = queryFilter.vertical.toUpperCase();
    }
    if (queryFilter.status && queryFilter.status !== 'all') {
      filter.status = queryFilter.status.toUpperCase();
    }
    if (queryFilter.search?.trim()) {
      const escaped = queryFilter.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { code: { $regex: escaped, $options: 'i' } },
        { vertical: { $regex: escaped, $options: 'i' } },
      ];
    }

    const page = Math.max(1, parseInt(queryFilter.page, 10) || 1);
    const limit = Math.max(1, parseInt(queryFilter.limit, 10) || 50);
    const skip = (page - 1) * limit;

    const [total, groups] = await Promise.all([
      RecommendationGroup.countDocuments(filter),
      RecommendationGroup.find(filter)
        .sort({ displayOrder: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('sourceCategoryId', 'name slug')
        .lean(),
    ]);

    // Compute live product counts for admin view
    const enriched = [];
    for (const g of groups) {
      let count = 0;
      if (g.mode === GroupMode.CATEGORY_DYNAMIC && g.sourceCategoryId) {
        const catId = (g.sourceCategoryId as any)._id || g.sourceCategoryId;
        const query = await RecommendationService.buildDynamicCategoryProductQuery(
          catId,
          g.matchingOnboardingSubcategories,
          g.excludedProductIds
        );
        count = await MasterProduct.countDocuments(query);
      } else if (g.mode === GroupMode.MANUAL_CURATED) {
        if (g.includedProductIds?.length) {
          count = await MasterProduct.countDocuments({
            _id: { $in: g.includedProductIds },
            status: 'ACTIVE',
          });
        } else if (g.matchingOnboardingSubcategories?.length) {
          const catId = (g.sourceCategoryId as any)?._id || g.sourceCategoryId;
          const subcats = await Subcategory.find({
            name: { $in: g.matchingOnboardingSubcategories },
            ...(catId ? { categoryId: catId } : {}),
            status: 'ACTIVE',
          }).select('_id').lean();
          const subcatIds = subcats.map((s) => s._id);
          if (subcatIds.length > 0) {
            count = await MasterProduct.countDocuments({
              subcategoryId: { $in: subcatIds },
              status: 'ACTIVE',
              _id: { $nin: g.excludedProductIds || [] },
            });
          }
        }
      }

      enriched.push({
        ...g,
        liveProductCount: count,
      });
    }

    return {
      items: enriched,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  static async createGroup(data: any, createdBy?: string): Promise<IRecommendationGroup> {
    const code = (
      data.code ||
      data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    ).toLowerCase();

    const existing = await RecommendationGroup.findOne({ code });
    if (existing) {
      throw new Error(`A recommendation group with code "${code}" already exists.`);
    }

    // Parse matchingOnboardingSubcategories if submitted as array of objects or string
    let subcats = data.matchingOnboardingSubcategories;
    if (Array.isArray(subcats)) {
      subcats = subcats.map((item: any) =>
        typeof item === 'object' && item !== null ? item.value || item.label || '' : String(item)
      ).filter(Boolean);
    } else if (typeof subcats === 'string') {
      subcats = subcats.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    const group = new RecommendationGroup({
      ...data,
      code,
      matchingOnboardingSubcategories: subcats,
      vertical: data.vertical.toUpperCase(),
      createdBy,
    });

    return await group.save();
  }

  static async updateGroup(id: string, data: any, updatedBy?: string): Promise<IRecommendationGroup | null> {
    if (data.vertical) {
      data.vertical = data.vertical.toUpperCase();
    }
    if (data.code) {
      data.code = data.code.toLowerCase().trim();
    }
    if (data.matchingOnboardingSubcategories !== undefined) {
      let subcats = data.matchingOnboardingSubcategories;
      if (Array.isArray(subcats)) {
        subcats = subcats.map((item: any) =>
          typeof item === 'object' && item !== null ? item.value || item.label || '' : String(item)
        ).filter(Boolean);
      } else if (typeof subcats === 'string') {
        subcats = subcats.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      data.matchingOnboardingSubcategories = subcats;
    }

    return await RecommendationGroup.findByIdAndUpdate(
      id,
      { ...data, updatedBy },
      { new: true, runValidators: true }
    );
  }

  static async deleteGroup(id: string): Promise<boolean> {
    const res = await RecommendationGroup.findByIdAndDelete(id);
    return !!res;
  }
}

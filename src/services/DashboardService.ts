import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import MasterProduct from '../models/MasterProduct';
import ProductSubmission from '../models/ProductSubmission';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';

type CacheEntry<T> = { value: T; expiresAt: number };
const dashboardCache = new Map<string, CacheEntry<any>>();

async function getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const existing = dashboardCache.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    return existing.value;
  }
  const value = await loader();
  dashboardCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export class DashboardService {
  static async getStats() {
    return getOrLoad('dashboard_stats', 20_000, async () => {
      const [
        sellerCounts,
        pendingSellerApprovals,
        totalCategories,
        totalSubcategories,
        totalProductTypes,
        productCounts,
        pendingProductSubmissions,
      ] = await Promise.all([
        Seller.aggregate<{ total: number; active: number }>([
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
            },
          },
        ]),
        SellerOnboarding.countDocuments({ status: 'PENDING_APPROVAL' }),
        Category.countDocuments({ status: 'ACTIVE' }),
        Subcategory.countDocuments({ status: 'ACTIVE' }),
        ProductType.countDocuments({ status: 'ACTIVE' }),
        MasterProduct.aggregate<{ total: number; active: number }>([
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
            },
          },
        ]),
        ProductSubmission.countDocuments({ status: 'PENDING', isMasterCatalogueProduct: { $ne: true } }),
      ]);

      const sc = sellerCounts[0];
      const pc = productCounts[0];

      return {
        totalSellers: sc?.total || 0,
        activeSellers: sc?.active || 0,
        pendingSellerApprovals,
        totalCategories,
        totalSubcategories,
        totalProductTypes,
        totalMasterProducts: pc?.total || 0,
        activeProducts: pc?.active || 0,
        pendingProductSubmissions,
      };
    });
  }

  static async getCategoryOverview() {
    return getOrLoad('category_overview', 60_000, async () => {
      const categories = await Category.find({ status: 'ACTIVE' })
        .select('name slug displayOrder imageUrl')
        .sort({ displayOrder: 1, name: 1 })
        .lean();

      const [subcategoryCounts, productCounts] = await Promise.all([
        Subcategory.aggregate<{ _id: unknown; count: number }>([
          { $match: { status: 'ACTIVE' } },
          { $group: { _id: '$categoryId', count: { $sum: 1 } } },
        ]),
        MasterProduct.aggregate<{ _id: unknown; total: number; active: number }>([
          { $group: { _id: '$categoryId', total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } } } },
        ]),
      ]);

      const subByCategory = new Map(subcategoryCounts.map((row) => [String(row._id), row.count]));
      const productsByCategory = new Map(
        productCounts.map((row) => [String(row._id), { total: row.total, active: row.active }]),
      );

      return categories.map((category) => {
        const id = String(category._id);
        const products = productsByCategory.get(id) || { total: 0, active: 0 };
        return {
          id,
          name: category.name,
          slug: category.slug,
          imageUrl: category.imageUrl || '',
          subcategoryCount: subByCategory.get(id) || 0,
          productCount: products.total,
          activeProductCount: products.active,
        };
      });
    });
  }

  static async getRecentActivity() {
    const [
      recentSellers,
      recentApprovedSellers,
      recentProducts,
      recentSubmissions,
      pendingApprovals,
    ] = await Promise.all([
      Seller.find().sort({ createdAt: -1 }).limit(5).lean(),
      Seller.find({ status: 'ACTIVE' }).sort({ updatedAt: -1 }).limit(5).lean(),
      MasterProduct.find().sort({ createdAt: -1 }).limit(5)
        .populate(['categoryId', 'productTypeId']).lean(),
      ProductSubmission.find().sort({ createdAt: -1 }).limit(5)
        .populate('sellerId').lean(),
      SellerOnboarding.find({ status: 'PENDING_APPROVAL' }).sort({ submittedAt: -1 }).limit(5)
        .populate('sellerId').lean(),
    ]);

    return {
      recentSellers,
      recentApprovedSellers,
      recentProducts,
      recentSubmissions,
      pendingApprovals,
    };
  }
}

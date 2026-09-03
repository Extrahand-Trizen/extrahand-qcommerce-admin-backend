import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import MasterProduct from '../models/MasterProduct';
import ProductSubmission from '../models/ProductSubmission';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';

export class DashboardService {
  static async getStats() {
    const [
      totalSellers,
      activeSellers,
      pendingSellerApprovals,
      totalCategories,
      totalSubcategories,
      totalProductTypes,
      totalMasterProducts,
      activeProducts,
      pendingProductSubmissions,
    ] = await Promise.all([
      Seller.countDocuments(),
      Seller.countDocuments({ status: 'ACTIVE' }),
      SellerOnboarding.countDocuments({ status: 'PENDING_APPROVAL' }),
      Category.countDocuments({ status: 'ACTIVE' }),
      Subcategory.countDocuments({ status: 'ACTIVE' }),
      ProductType.countDocuments({ status: 'ACTIVE' }),
      MasterProduct.countDocuments(),
      MasterProduct.countDocuments({ status: 'ACTIVE' }),
      ProductSubmission.countDocuments({ status: 'PENDING' }),
    ]);

    return {
      totalSellers,
      activeSellers,
      pendingSellerApprovals,
      totalCategories,
      totalSubcategories,
      totalProductTypes,
      totalMasterProducts,
      activeProducts,
      pendingProductSubmissions,
    };
  }

  static async getCategoryOverview() {
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

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
      Category.countDocuments(),
      Subcategory.countDocuments(),
      ProductType.countDocuments(),
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

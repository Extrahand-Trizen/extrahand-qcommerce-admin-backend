import ProductSubmission from '../models/ProductSubmission';
import MasterProduct from '../models/MasterProduct';
import { MasterProductService } from './MasterProductService';
import { paginate } from '../utils/pagination';
import { PaginationQuery } from '../types';
import { AppError } from '../utils/response';
import { FilterQuery } from 'mongoose';

export class ProductSubmissionService {
  static async list(query: PaginationQuery & { status?: string; sellerId?: string }) {
    const filter: FilterQuery<typeof ProductSubmission> = {};
    if (query.status) filter.status = query.status;
    if (query.sellerId) filter.sellerId = query.sellerId;
    if (query.search) filter.submittedProductName = { $regex: query.search, $options: 'i' };
    return paginate(ProductSubmission, filter, query, ['sellerId', 'categoryId', 'subcategoryId', 'productTypeId']);
  }

  static async getById(id: string) {
    const submission = await ProductSubmission.findById(id)
      .populate(['sellerId', 'categoryId', 'subcategoryId', 'productTypeId', 'mappedMasterProductId']);
    if (!submission) throw new AppError('Submission not found', 404);
    return submission;
  }

  static async review(
    id: string,
    action: string,
    adminComment: string | undefined,
    adminId: string,
    masterProductId?: string,
    // Phase 6 wires the real value from the review body / submission; kept
    // optional here so the schema change does not break the current flow.
    sellingPricePaise = 0,
  ) {
    const submission = await ProductSubmission.findById(id);
    if (!submission) throw new AppError('Submission not found', 404);
    if (submission.status === 'APPROVED') throw new AppError('Submission already approved', 400);

    submission.reviewedBy = adminId;
    submission.reviewedAt = new Date();
    submission.adminComment = adminComment;

    switch (action) {
      case 'APPROVE':
        if (masterProductId) {
          const existing = await MasterProduct.findById(masterProductId);
          if (!existing) throw new AppError('Master product not found', 404);
          submission.mappedMasterProductId = existing._id;
        } else {
          const created = await MasterProductService.create({
            name: submission.submittedProductName,
            categoryId: submission.categoryId,
            subcategoryId: submission.subcategoryId,
            productTypeId: submission.productTypeId,
            brand: submission.brand,
            description: submission.description,
            // sku omitted -> MasterProductService generates MP-<CAT>-<NAME>-<SEQ>
            sellingPricePaise,
            attributes: submission.requestedAttributes,
            images: submission.images.map((url, idx) => ({
              imageUrl: url,
              displayOrder: idx,
              isPrimary: idx === 0,
            })),
          }, adminId);
          submission.mappedMasterProductId = created.product._id;
        }
        submission.status = 'APPROVED';
        break;
      case 'REJECT':
        submission.status = 'REJECTED';
        break;
      case 'CHANGES_REQUIRED':
        submission.status = 'CHANGES_REQUIRED';
        break;
      default:
        throw new AppError('Invalid action', 400);
    }

    await submission.save();
    return submission;
  }
}

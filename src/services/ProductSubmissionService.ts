import ProductSubmission from '../models/ProductSubmission';
import MasterProduct from '../models/MasterProduct';
import SellerListing from '../models/SellerListing';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import { MasterProductService } from './MasterProductService';
import { paginate } from '../utils/pagination';
import { PaginationQuery, ProductAttributeValue, ProductInformation } from '../types';
import { AppError } from '../utils/response';
import { FilterQuery } from 'mongoose';

interface ReviewImageInput {
  imageUrl: string;
  isPrimary?: boolean;
  displayOrder?: number;
}

interface ReviewOptions {
  /** Map to an existing master product instead of creating one. */
  masterProductId?: string;
  /** Fill / override the taxonomy the shopkeeper did not provide. */
  subcategoryId?: string;
  productTypeId?: string;
  /** Admin overrides for fields the seller left blank or incomplete. */
  name?: string;
  brand?: string;
  description?: string;
  sku?: string;
  gtin?: string;
  complianceInfo?: string;
  attributes?: ProductAttributeValue[];
  images?: ReviewImageInput[];
  productInformation?: ProductInformation;
  sellingPricePaise?: number;
  /** When true (default), add an approved listing for the submitting seller. */
  createSellerListing?: boolean;
}

export class ProductSubmissionService {
  /* ---------------- admin ---------------- */

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
    opts: ReviewOptions = {},
  ) {
    const submission = await ProductSubmission.findById(id);
    if (!submission) throw new AppError('Submission not found', 404);
    if (submission.status === 'APPROVED') throw new AppError('Submission already approved', 400);

    submission.reviewedBy = adminId;
    submission.reviewedAt = new Date();
    submission.adminComment = adminComment;

    switch (action) {
      case 'APPROVE': {
        let masterProductId: string;
        const listingPrice = opts.sellingPricePaise ?? submission.sellingPricePaise;

        if (opts.masterProductId) {
          const existing = await MasterProduct.findById(opts.masterProductId);
          if (!existing) throw new AppError('Master product not found', 404);
          masterProductId = existing._id.toString();
          submission.mappedMasterProductId = existing._id;
        } else {
          const subcategoryId = opts.subcategoryId ?? submission.subcategoryId?.toString();
          const productTypeId = opts.productTypeId ?? submission.productTypeId?.toString();
          if (!subcategoryId || !productTypeId) {
            throw new AppError(
              'This request needs a subcategory and product type before it can be approved',
              400,
            );
          }
          await this.assertHierarchy(submission.categoryId.toString(), subcategoryId, productTypeId);

          submission.subcategoryId = subcategoryId as never;
          submission.productTypeId = productTypeId as never;

          const attributes = opts.attributes ?? submission.requestedAttributes ?? [];
          const images = this.resolveReviewImages(submission, opts.images);

          const created = await MasterProductService.create(
            {
              name: (opts.name?.trim() || submission.submittedProductName).trim(),
              categoryId: submission.categoryId,
              subcategoryId,
              productTypeId,
              brand: opts.brand?.trim() || submission.brand,
              description: opts.description?.trim() || submission.description,
              sku: opts.sku?.trim(),
              gtin: opts.gtin?.trim(),
              complianceInfo: opts.complianceInfo?.trim(),
              attributes,
              images,
              productInformation: opts.productInformation,
              ...(listingPrice != null && listingPrice >= 0
                ? { sellingPricePaise: Math.round(listingPrice) }
                : {}),
            },
            adminId,
          );
          masterProductId = created.product._id.toString();
          submission.mappedMasterProductId = created.product._id;
        }

        const shouldCreateListing = opts.createSellerListing !== false;
        if (shouldCreateListing && listingPrice != null && listingPrice >= 0) {
          await SellerListing.findOneAndUpdate(
            { sellerId: submission.sellerId, masterProductId },
            {
              sellerId: submission.sellerId,
              masterProductId,
              sellingPricePaise: Math.round(listingPrice),
              status: 'ACTIVE',
              availability: 'AVAILABLE',
              reviewStatus: 'APPROVED',
            },
            { upsert: true, new: true },
          );
        }

        submission.status = 'APPROVED';
        break;
      }
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

  private static resolveReviewImages(
    submission: { photoUrl?: string; images?: string[] },
    adminImages?: ReviewImageInput[],
  ) {
    if (adminImages?.length) {
      const cleaned = adminImages
        .map((img, idx) => ({
          imageUrl: img.imageUrl.trim(),
          displayOrder: img.displayOrder ?? idx,
          isPrimary: img.isPrimary ?? idx === 0,
        }))
        .filter((img) => img.imageUrl);
      if (cleaned.length && !cleaned.some((img) => img.isPrimary)) {
        cleaned[0].isPrimary = true;
      }
      return cleaned;
    }

    const urls = [
      ...(submission.photoUrl ? [submission.photoUrl] : []),
      ...(submission.images || []),
    ].filter(Boolean);
    return urls.map((url, idx) => ({
      imageUrl: url,
      displayOrder: idx,
      isPrimary: idx === 0,
    }));
  }

  private static async assertHierarchy(categoryId: string, subcategoryId: string, productTypeId: string) {
    const [cat, sub, pt] = await Promise.all([
      Category.findById(categoryId).select('_id'),
      Subcategory.findById(subcategoryId).select('categoryId'),
      ProductType.findById(productTypeId).select('subcategoryId'),
    ]);
    if (!cat) throw new AppError('Category not found', 404);
    if (!sub || sub.categoryId.toString() !== categoryId) {
      throw new AppError('Subcategory does not belong to the category', 400);
    }
    if (!pt || pt.subcategoryId.toString() !== subcategoryId) {
      throw new AppError('Product type does not belong to the subcategory', 400);
    }
  }

  /* ---------------- seller ---------------- */

  static async createRequest(
    sellerId: string,
    input: {
      name: string;
      categoryId: string;
      packOrSoldAs?: string;
      sellingPricePaise?: number;
      photoUrl?: string;
      brand?: string;
      description?: string;
    },
  ) {
    if (!input.name?.trim()) throw new AppError('Product name is required', 400);
    const category = await Category.findById(input.categoryId).select('_id');
    if (!category) throw new AppError('Category not found', 404);

    return ProductSubmission.create({
      sellerId,
      submittedProductName: input.name.trim(),
      categoryId: input.categoryId,
      brand: input.brand?.trim(),
      description: input.description?.trim(),
      packOrSoldAs: input.packOrSoldAs?.trim(),
      sellingPricePaise:
        input.sellingPricePaise != null && input.sellingPricePaise >= 0
          ? Math.round(input.sellingPricePaise)
          : undefined,
      photoUrl: input.photoUrl,
      requestedAttributes: [],
      images: [],
      status: 'PENDING',
    });
  }

  static async listMine(sellerId: string, query: PaginationQuery & { status?: string }) {
    const filter: FilterQuery<typeof ProductSubmission> = { sellerId };
    if (query.status) filter.status = query.status;

    const result = await paginate(ProductSubmission, filter, query, ['categoryId', 'mappedMasterProductId']);

    // mark which approved requests are already in the seller's store
    const mappedIds = result.items
      .map((s) => (s as { mappedMasterProductId?: { _id?: unknown } }).mappedMasterProductId?._id)
      .filter(Boolean);
    const listings = mappedIds.length
      ? await SellerListing.find({ sellerId, masterProductId: { $in: mappedIds } })
          .select('masterProductId')
          .lean()
      : [];
    const addedSet = new Set(listings.map((l) => String(l.masterProductId)));

    result.items = result.items.map((s) => {
      const mp = (s as { mappedMasterProductId?: { _id?: unknown } }).mappedMasterProductId?._id;
      return { ...(s as object), alreadyAdded: mp ? addedSet.has(String(mp)) : false } as never;
    });
    return result;
  }

  static async resubmit(
    sellerId: string,
    id: string,
    patch: {
      name?: string;
      categoryId?: string;
      packOrSoldAs?: string;
      sellingPricePaise?: number;
      photoUrl?: string;
      brand?: string;
      description?: string;
    },
  ) {
    const submission = await ProductSubmission.findById(id);
    if (!submission) throw new AppError('Request not found', 404);
    if (submission.sellerId.toString() !== sellerId) throw new AppError('Not your request', 403);
    if (!['REJECTED', 'CHANGES_REQUIRED'].includes(submission.status)) {
      throw new AppError('Only rejected or changes-required requests can be edited', 400);
    }

    if (patch.name?.trim()) submission.submittedProductName = patch.name.trim();
    if (patch.categoryId) {
      const cat = await Category.findById(patch.categoryId).select('_id');
      if (!cat) throw new AppError('Category not found', 404);
      submission.categoryId = cat._id;
    }
    if (patch.packOrSoldAs !== undefined) submission.packOrSoldAs = patch.packOrSoldAs.trim();
    if (patch.sellingPricePaise != null && patch.sellingPricePaise >= 0) {
      submission.sellingPricePaise = Math.round(patch.sellingPricePaise);
    }
    if (patch.photoUrl !== undefined) submission.photoUrl = patch.photoUrl;
    if (patch.brand !== undefined) submission.brand = patch.brand.trim();
    if (patch.description !== undefined) submission.description = patch.description.trim();

    submission.status = 'PENDING';
    submission.adminComment = undefined;
    await submission.save();
    return submission;
  }
}

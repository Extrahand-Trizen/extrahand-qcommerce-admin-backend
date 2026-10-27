import ProductSubmission from '../models/ProductSubmission';
import MasterProduct from '../models/MasterProduct';
import SellerListing from '../models/SellerListing';
import ShopInventory from '../models/ShopInventory';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import ProductTypeAttribute from '../models/ProductTypeAttribute';
import SellerOnboarding from '../models/SellerOnboarding';
import { MasterProductService } from './MasterProductService';
import { paginate } from '../utils/pagination';
import { PaginationQuery, ProductAttributeValue, ProductInformation } from '../types';
import { AppError } from '../utils/response';
import mongoose, { FilterQuery } from 'mongoose';

interface ReviewImageInput {
  imageUrl: string;
  isPrimary?: boolean;
  displayOrder?: number;
}

interface ReviewOptions {
  /** Map to an existing master product instead of creating one. */
  masterProductId?: string;
  /** When true, add the approved custom product to the public Master Catalogue for all sellers. */
  addToMasterCatalogue?: boolean;
  /** Fill / override the taxonomy the shopkeeper did not provide. */
  categoryId?: string;
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
  quantity?: number;
  lifespanValue?: number;
  lifespanUnit?: string;
  /** When true (default), add an approved listing for the submitting seller. */
  createSellerListing?: boolean;
}

export class ProductSubmissionService {
  /* ---------------- admin ---------------- */

  static async getStats(sellerId?: string) {
    const filter: FilterQuery<typeof ProductSubmission> = {
      isMasterCatalogueProduct: { $ne: true },
    };
    if (sellerId && sellerId !== 'all') {
      filter.sellerId = sellerId;
    }
    const [pending, approved, rejected, deleted, all] = await Promise.all([
      ProductSubmission.countDocuments({ ...filter, status: 'PENDING' }),
      ProductSubmission.countDocuments({ ...filter, status: 'APPROVED' }),
      ProductSubmission.countDocuments({ ...filter, status: 'REJECTED' }),
      ProductSubmission.countDocuments({ ...filter, status: 'DELETED' }),
      ProductSubmission.countDocuments(filter),
    ]);
    return {
      pending,
      approved,
      rejected,
      deleted,
      all,
    };
  }

  static async list(query: PaginationQuery & { status?: string; sellerId?: string; categoryId?: string; dateRange?: string }) {
    const filter: FilterQuery<typeof ProductSubmission> = {
      isMasterCatalogueProduct: { $ne: true },
    };
    if (query.status && query.status !== 'ALL') filter.status = query.status;
    if (query.sellerId && query.sellerId !== 'all') filter.sellerId = query.sellerId;
    if (query.categoryId && query.categoryId !== 'all') filter.categoryId = query.categoryId;
    if (query.dateRange && query.dateRange !== 'all') {
      const now = new Date();
      if (query.dateRange === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        filter.createdAt = { $gte: start };
      } else if (query.dateRange === 'last_7_days') {
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        filter.createdAt = { $gte: start };
      } else if (query.dateRange === 'last_30_days') {
        const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        filter.createdAt = { $gte: start };
      } else if (query.dateRange === 'this_month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        filter.createdAt = { $gte: start, $lte: end };
      }
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      const orConditions: Array<Record<string, any>> = [
        { submittedProductName: { $regex: q, $options: 'i' } },
        { brand: { $regex: q, $options: 'i' } },
      ];
      if (mongoose.Types.ObjectId.isValid(q)) {
        orConditions.push({ _id: new mongoose.Types.ObjectId(q) });
      }
      filter.$or = orConditions;
    }
    const result = await paginate(ProductSubmission, filter, query, [
      'sellerId',
      'categoryId',
      'subcategoryId',
      'productTypeId',
      'mappedMasterProductId',
    ]);
    const sellerIds = result.items
      .map((item: any) => item.sellerId?._id || item.sellerId)
      .filter(Boolean);
    const onboardings = await SellerOnboarding.find({ sellerId: { $in: sellerIds } }).select('sellerId shopName').lean();
    const shopNameMap = new Map(onboardings.map((o) => [o.sellerId.toString(), o.shopName]));

    result.items = result.items.map((item: any) => {
      const sObj = item.toObject ? item.toObject() : { ...item };
      if (sObj.sellerId && typeof sObj.sellerId === 'object') {
        const sId = sObj.sellerId._id.toString();
        sObj.sellerId.shopName = shopNameMap.get(sId)?.trim() || sObj.sellerId.fullName || 'Store';
      }
      return sObj;
    });
    return result;
  }

  static async getById(id: string) {
    const submission = await ProductSubmission.findById(id)
      .populate([
        'sellerId',
        'categoryId',
        'subcategoryId',
        'productTypeId',
        'mappedMasterProductId',
        { path: 'requestedAttributes.attributeId', select: 'name key type unit options' },
      ]);
    if (!submission) throw new AppError('Submission not found', 404);

    const obj = submission.toObject();
    if (obj.sellerId && typeof obj.sellerId === 'object') {
      const onboarding = await SellerOnboarding.findOne({ sellerId: (obj.sellerId as any)._id }).select('shopName').lean();
      (obj.sellerId as any).shopName = onboarding?.shopName?.trim() || (obj.sellerId as any).fullName || 'Store';
    }
    return obj;
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
          if (existing.status !== 'ACTIVE') {
            throw new AppError('Cannot map to an inactive master product', 400);
          }
          masterProductId = existing._id.toString();
          submission.mappedMasterProductId = existing._id;
        } else {
          const targetStatus = opts.addToMasterCatalogue ? 'ACTIVE' : 'DRAFT';
          const categoryId = (opts.categoryId?.trim() || submission.categoryId)?.toString();
          const subcategoryId = (opts.subcategoryId?.trim() || submission.subcategoryId)?.toString();
          const productTypeId = (opts.productTypeId?.trim() || submission.productTypeId)?.toString();
          if (!categoryId || !subcategoryId || !productTypeId) {
            throw new AppError(
              'This request needs a category, subcategory, and product type before it can be approved',
              400,
            );
          }
          await this.assertHierarchy(categoryId, subcategoryId, productTypeId);

          submission.categoryId = categoryId as never;
          submission.subcategoryId = subcategoryId as never;
          submission.productTypeId = productTypeId as never;

          const attributes = await this.mergeApprovalAttributes(
            productTypeId,
            opts.attributes ?? submission.requestedAttributes ?? [],
            submission.packOrSoldAs,
          );
          const images = this.resolveReviewImages(submission, opts.images);

          const lifespanValue = opts.lifespanValue ?? submission.lifespanValue;
          const lifespanUnit = opts.lifespanUnit ?? submission.lifespanUnit;

          let targetMasterProduct = submission.mappedMasterProductId
            ? await MasterProduct.findById(submission.mappedMasterProductId)
            : null;

          if (!targetMasterProduct) {
            const prodName = (opts.name?.trim() || submission.submittedProductName).trim();
            targetMasterProduct = await MasterProduct.findOne({
              categoryId,
              subcategoryId,
              productTypeId,
              name: { $regex: `^${prodName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}$`, $options: 'i' },
              ...(opts.brand?.trim() || submission.brand ? { brand: (opts.brand?.trim() || submission.brand)?.trim() } : {}),
            });
          }

          if (targetMasterProduct) {
            await MasterProduct.findByIdAndUpdate(targetMasterProduct._id, {
              status: targetStatus,
              updatedBy: adminId,
            });
            masterProductId = targetMasterProduct._id.toString();
            submission.mappedMasterProductId = targetMasterProduct._id;
          } else {
            const created = await MasterProductService.create(
              {
                status: targetStatus,
                name: (opts.name?.trim() || submission.submittedProductName).trim(),
                categoryId,
                subcategoryId,
                productTypeId,
                brand: opts.brand?.trim() || submission.brand,
                description: opts.description?.trim() || submission.description,
                sku: opts.sku?.trim(),
                gtin: opts.gtin?.trim(),
                complianceInfo: opts.complianceInfo?.trim(),
                attributes,
                images,
                productInformation: {
                  ...(opts.productInformation || {}),
                  ...(submission.manufacturerName && !opts.productInformation?.manufacturer
                    ? { manufacturer: submission.manufacturerName }
                    : {}),
                  ...(submission.manufacturerAddress && !opts.productInformation?.manufacturerAddress
                    ? { manufacturerAddress: submission.manufacturerAddress }
                    : {}),
                  ...(submission.keyIngredients && !opts.productInformation?.ingredients
                    ? { ingredients: submission.keyIngredients }
                    : {}),
                  ...(submission.storageCondition && !opts.productInformation?.storageInformation
                    ? { storageInformation: submission.storageCondition }
                    : {}),
                  ...(submission.directionsForUse && !opts.productInformation?.usageInstructions
                    ? { usageInstructions: submission.directionsForUse }
                    : {}),
                  ...(submission.keyBenefits && !opts.productInformation?.healthBenefits
                    ? { healthBenefits: submission.keyBenefits }
                    : {}),
                  ...(submission.allergenInfo && !opts.productInformation?.allergens
                    ? { allergens: submission.allergenInfo }
                    : {}),
                  ...(submission.genericName ? { genericName: submission.genericName } : {}),
                  ...(submission.dosageForm ? { dosageForm: submission.dosageForm } : {}),
                  ...(submission.routeOfAdmin ? { routeOfAdmin: submission.routeOfAdmin } : {}),
                  ...(submission.strength ? { strength: `${submission.strength} ${submission.strengthUnit || ''}`.trim() } : {}),
                  ...(submission.prescriptionCategory ? { prescriptionCategory: submission.prescriptionCategory } : {}),
                  ...(submission.sideEffects ? { sideEffects: submission.sideEffects } : {}),
                  ...(submission.indication ? { indication: submission.indication } : {}),
                  ...(submission.marketerName ? { marketerName: submission.marketerName } : {}),
                  ...(submission.countryOfOrigin ? { countryOfOrigin: submission.countryOfOrigin } : {}),
                  ...(submission.disclaimer ? { disclaimer: submission.disclaimer } : {}),
                  ...(submission.sterility ? { sterility: submission.sterility } : {}),
                  ...(submission.useType ? { useType: submission.useType } : {}),
                  ...(submission.licenceNumber ? { licenceNumber: submission.licenceNumber } : {}),
                  ...(submission.regulatoryInfo ? { regulatoryInfo: submission.regulatoryInfo } : {}),
                  ...(submission.coldChainRequired != null ? { coldChainRequired: submission.coldChainRequired } : {}),
                  ...(submission.prescriptionRequired != null ? { prescriptionRequired: submission.prescriptionRequired } : {}),
                },
                lifespanValue,
                lifespanUnit,
                ...(listingPrice != null && listingPrice >= 0
                  ? { sellingPricePaise: Math.round(listingPrice) }
                  : {}),
              },
              adminId,
            );
            masterProductId = created.product._id.toString();
            submission.mappedMasterProductId = created.product._id;
          }
        }

        const shouldCreateListing = opts.createSellerListing !== false;
        if (shouldCreateListing && listingPrice != null && listingPrice >= 0) {
          const initialStock = Math.max(0, Math.round(Number(opts.quantity ?? submission.quantity) || 0));
          const customProductInformation: Record<string, any> = {
            ...(submission.isMedicalProduct || submission.genericName ? {
              genericName: submission.genericName,
              dosageForm: submission.dosageForm,
              routeOfAdmin: submission.routeOfAdmin,
              strength: submission.strength ? `${submission.strength} ${submission.strengthUnit || ''}`.trim() : undefined,
              prescriptionCategory: submission.prescriptionCategory,
              batchNumber: submission.batchNumber,
              mfgDate: submission.mfgDate,
              expiryDate: submission.expiryDate,
              rackLocation: submission.rackLocation,
              coldChainRequired: submission.coldChainRequired ?? false,
              prescriptionRequired: submission.prescriptionRequired ?? false,
              mrpPaise: submission.mrpPaise,
              unitOfSale: submission.unitOfSale || submission.packOrSoldAs,
              prescriptionDocUrl: submission.prescriptionDocUrl,
              sideEffects: submission.sideEffects,
              indication: submission.indication,
              safetyInfo: submission.safetyInfo,
              marketerName: submission.marketerName,
              countryOfOrigin: submission.countryOfOrigin,
              licenceNumber: submission.licenceNumber,
              regulatoryInfo: submission.regulatoryInfo,
            } : {}),
          };

          const listing = await SellerListing.findOneAndUpdate(
            { sellerId: submission.sellerId, masterProductId },
            {
              sellerId: submission.sellerId,
              masterProductId,
              sellingPricePaise: Math.round(listingPrice),
              stock: initialStock,
              reserved: 0,
              status: 'ACTIVE',
              availability: initialStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
              reviewStatus: 'APPROVED',
              unit: submission.packOrSoldAs || submission.unitOfSale || undefined,
              ...(Object.keys(customProductInformation).length ? { customProductInformation } : {}),
            },
            { upsert: true, new: true },
          );

          await ShopInventory.findOneAndUpdate(
            { sellerId: submission.sellerId, listingId: listing._id },
            {
              sellerId: submission.sellerId,
              listingId: listing._id,
              masterProductId,
              stock: initialStock,
              reserved: 0,
            },
            { upsert: true, new: true },
          );
        }

        submission.status = 'APPROVED';
        break;
      }
      case 'REJECT': {
        submission.status = 'REJECTED';
        submission.adminComment = adminComment?.trim() || 'Product submission rejected by admin.';
        submission.reviewedAt = new Date();
        submission.reviewedBy = adminId;

        // A rejected product must NOT show in the seller's store!
        // Remove the listing and inventory so it is gone from "My Store".
        // Custom products remain tracked in View Requests (ProductSubmission) with the reject note & edit option.
        // Master catalogue products will appear back in Master Catalogue as unadded.
        if (submission.mappedMasterProductId && submission.sellerId) {
          const listings = await SellerListing.find({
            sellerId: submission.sellerId,
            masterProductId: submission.mappedMasterProductId,
          }).select('_id');
          if (listings.length) {
            const listingIds = listings.map((l) => l._id);
            await ShopInventory.deleteMany({ listingId: { $in: listingIds } });
            await SellerListing.deleteMany({ _id: { $in: listingIds } });
          }
        }
        break;
      }
      case 'CHANGES_REQUIRED': {
        submission.status = 'CHANGES_REQUIRED';
        submission.adminComment = adminComment?.trim() || 'Changes required by admin.';
        submission.reviewedAt = new Date();
        submission.reviewedBy = adminId;

        if (submission.mappedMasterProductId && submission.sellerId) {
          const listings = await SellerListing.find({
            sellerId: submission.sellerId,
            masterProductId: submission.mappedMasterProductId,
          }).select('_id');
          if (listings.length) {
            const listingIds = listings.map((l) => l._id);
            await ShopInventory.deleteMany({ listingId: { $in: listingIds } });
            await SellerListing.deleteMany({ _id: { $in: listingIds } });
          }
        }
        break;
      }
      default:
        throw new AppError('Invalid action', 400);
    }

    await submission.save();
    return submission;
  }

  private static async mergeApprovalAttributes(
    productTypeId: string,
    adminAttributes: ProductAttributeValue[],
    packOrSoldAs?: string,
  ): Promise<ProductAttributeValue[]> {
    const attrs = [...adminAttributes];
    const trimmedPack = packOrSoldAs?.trim();
    if (!trimmedPack) return attrs;

    const mappings = await ProductTypeAttribute.find({ productTypeId }).populate(
      'attributeId',
      'key options',
    );
    const soldAsMapping = mappings.find((mapping) => {
      const attr = mapping.attributeId as {
        key?: string;
        _id: { toString: () => string };
        options?: Array<{ value: string; isActive: boolean }>;
      };
      return attr?.key === 'sold_as';
    });
    if (!soldAsMapping) return attrs;

    const soldAsAttr = soldAsMapping.attributeId as {
      _id: { toString: () => string };
      options?: Array<{ value: string; isActive: boolean }>;
    };
    const soldAsId = soldAsAttr._id.toString();
    const hasExplicit = attrs.some((a) => String(a.attributeId) === soldAsId);
    if (hasExplicit) return attrs;

    const allowed = (soldAsAttr.options || [])
      .filter((option) => option.isActive)
      .map((option) => option.value);
    const resolved = this.resolveSoldAsFromPack(trimmedPack, allowed);
    if (!resolved) return attrs;

    return [...attrs, { attributeId: soldAsId, value: resolved }];
  }

  private static async validateRequestedAttributes(
    productTypeId: string,
    requested: ProductAttributeValue[],
  ): Promise<ProductAttributeValue[]> {
    if (!mongoose.Types.ObjectId.isValid(productTypeId)) return requested;
    const mappings = await ProductTypeAttribute.find({ productTypeId })
      .populate('attributeId', 'name type options isActive')
      .lean();
    const mappingById = new Map(mappings.map((mapping) => [
      String((mapping.attributeId as { _id: unknown })._id),
      mapping,
    ]));
    const values = new Map(requested.map((item) => [String(item.attributeId), item.value]));

    for (const mapping of mappings) {
      const attribute = mapping.attributeId as unknown as {
        _id: unknown;
        name: string;
        type: string;
        options?: Array<{ value: string; isActive?: boolean }>;
      };
      const value = values.get(String(attribute._id));
      const empty = value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0);
      if (mapping.isRequired && empty) {
        throw new AppError(`${attribute.name} is required`, 400);
      }
      if (empty) continue;

      if (attribute.type === 'NUMBER' && (typeof value !== 'number' || !Number.isFinite(value))) {
        throw new AppError(`${attribute.name} must be a number`, 400);
      }
      if (attribute.type === 'BOOLEAN' && typeof value !== 'boolean') {
        throw new AppError(`${attribute.name} must be true or false`, 400);
      }
      if (attribute.type === 'MULTI_SELECT' && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) {
        throw new AppError(`${attribute.name} has invalid selections`, 400);
      }
      if (attribute.type === 'DROPDOWN' || attribute.type === 'MULTI_SELECT') {
        const allowed = new Set((attribute.options || []).filter((option) => option.isActive !== false).map((option) => option.value));
        const selected = Array.isArray(value) ? value : [value];
        if (selected.some((item) => typeof item !== 'string' || !allowed.has(item))) {
          throw new AppError(`${attribute.name} has an invalid option`, 400);
        }
      }
    }

    for (const item of requested) {
      if (!mappingById.has(String(item.attributeId))) {
        throw new AppError('One or more attributes are not configured for this product type', 400);
      }
    }
    return requested;
  }

  private static async resolvePackOrSoldAs(
    productTypeId: string,
    requested: ProductAttributeValue[],
    explicit?: string,
  ): Promise<string | undefined> {
    if (explicit?.trim()) return explicit.trim();
    if (!mongoose.Types.ObjectId.isValid(productTypeId)) return undefined;
    const mappings = await ProductTypeAttribute.find({ productTypeId, isVariantAttribute: true })
      .populate('attributeId', 'name')
      .sort({ variantOrder: 1, displayOrder: 1 })
      .lean();
    const values = new Map(requested.map((item) => [String(item.attributeId), item.value]));
    const parts = mappings
      .map((mapping) => values.get(String((mapping.attributeId as { _id: unknown })._id)))
      .filter((value) => value != null && String(value).trim())
      .map((value) => Array.isArray(value) ? value.join(', ') : String(value).trim());
    return parts.length ? parts.join(' ') : undefined;
  }

  private static resolveSoldAsFromPack(packOrSoldAs: string, allowed: string[]): string | undefined {
    const trimmed = packOrSoldAs.trim();
    if (!trimmed) return undefined;

    return allowed.find((option) => option.toLowerCase() === trimmed.toLowerCase());
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
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      throw new AppError('Invalid category ID', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(subcategoryId)) {
      throw new AppError('Invalid subcategory selected', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(productTypeId)) {
      throw new AppError('Invalid product type selected', 400);
    }

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
      categoryId?: string;
      subcategoryId?: string;
      productTypeId?: string;
      requestedAttributes?: ProductAttributeValue[];
      packOrSoldAs?: string;
      sellingPricePaise?: number;
      quantity?: number;
      lifespanValue?: number;
      lifespanUnit?: string;
      photoUrl?: string;
      frontImageUrl?: string;
      images?: string[];
      ingredientsImageUrl?: string;
      brand?: string;
      description?: string;
      manufacturerName?: string;
      manufacturerAddress?: string;

      /** Medical fields */
      isMedicalProduct?: boolean;
      productType?: string;
      medicalCategory?: string;
      medicalSubcategory?: string;
      genericName?: string;
      dosageForm?: string;
      routeOfAdmin?: string;
      strength?: string;
      strengthUnit?: string;
      packSize?: string;
      packagingType?: string;
      netContent?: string;
      releaseType?: string;
      productForm?: string;
      indication?: string;
      directionsForUse?: string;
      keyBenefits?: string;
      keyIngredients?: string;
      safetyInfo?: string;
      sideEffects?: string;
      allergenInfo?: string;
      storageCondition?: string;
      disclaimer?: string;
      sterility?: string;
      useType?: string;
      marketerName?: string;
      countryOfOrigin?: string;
      licenceNumber?: string;
      prescriptionCategory?: string;
      regulatoryInfo?: string;
      mrpPaise?: number;
      unitOfSale?: string;
      batchNumber?: string;
      mfgDate?: string;
      expiryDate?: string;
      rackLocation?: string;
      coldChainRequired?: boolean;
      prescriptionRequired?: boolean;
      prescriptionDocUrl?: string;
      additionalNotes?: string;
    },
  ) {
    if (!input.name?.trim()) throw new AppError('Product name is required', 400);

    const isMedical = Boolean(
      input.isMedicalProduct ||
      input.genericName?.trim() ||
      input.medicalCategory?.trim() ||
      input.dosageForm?.trim()
    );

    // Resolve Category
    let categoryDoc: { _id: mongoose.Types.ObjectId } | null = null;

    // For medical products, prioritize matching the specific medicalCategory first
    if (isMedical && input.medicalCategory?.trim()) {
      const medCatName = input.medicalCategory.trim();
      const medCatSlug = medCatName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      categoryDoc = await Category.findOne({
        $or: [
          { name: { $regex: new RegExp(`^${medCatName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}$`, 'i') } },
          { slug: medCatSlug },
        ],
      }).select('_id');
    }

    if (!categoryDoc && input.categoryId && mongoose.Types.ObjectId.isValid(input.categoryId)) {
      categoryDoc = await Category.findById(input.categoryId).select('_id');
    }

    if (!categoryDoc) {
      // Find matching Pharmacy or Health category by name or slug
      categoryDoc = await Category.findOne({
        $or: [
          ...(input.medicalCategory ? [{ name: input.medicalCategory }, { slug: input.medicalCategory.toLowerCase().replace(/[^a-z0-9]+/g, '-') }] : []),
          { vertical: 'MEDICAL' },
          { code: 'MED' },
          { slug: 'pharmacy-medicines' },
          { name: 'Pharmacy & Medicines' },
          { slug: 'health' },
          { name: 'Health & Wellness' },
        ],
      }).select('_id');
    }

    if (!categoryDoc) {
      // Fallback to any active category
      categoryDoc = await Category.findOne({ status: 'ACTIVE' }).select('_id');
    }
    if (!categoryDoc) {
      categoryDoc = await Category.findOne().select('_id');
    }
    if (!categoryDoc) {
      throw new AppError('Category not found', 404);
    }

    const resolvedCategoryId = categoryDoc._id;

    // Category hierarchy validation
    if (!isMedical) {
      if (!input.subcategoryId || !input.productTypeId) {
        throw new AppError('Subcategory and product type are required', 400);
      }
      await this.assertHierarchy(resolvedCategoryId.toString(), input.subcategoryId, input.productTypeId);
    } else if (input.subcategoryId && input.productTypeId && mongoose.Types.ObjectId.isValid(input.subcategoryId) && mongoose.Types.ObjectId.isValid(input.productTypeId)) {
      await this.assertHierarchy(resolvedCategoryId.toString(), input.subcategoryId, input.productTypeId);
    }

    const requestedAttributes =
      input.productTypeId && mongoose.Types.ObjectId.isValid(input.productTypeId)
        ? await this.validateRequestedAttributes(input.productTypeId, input.requestedAttributes || [])
        : (input.requestedAttributes || []);

    if (input.sellingPricePaise == null || input.sellingPricePaise <= 0) {
      throw new AppError('Price is required and must be greater than 0', 400);
    }
    const uploadedImages = (input.images || [])
      .map((url) => String(url || '').trim())
      .filter(Boolean);
    const front = input.frontImageUrl?.trim() || input.photoUrl?.trim() || uploadedImages[0];
    if (!front || /^(content|file):\/\//i.test(front)) {
      throw new AppError('A product image must be uploaded before submission', 400);
    }
    if (uploadedImages.some((url) => /^(content|file):\/\//i.test(url))) {
      throw new AppError('All product images must be uploaded before submission', 400);
    }

    let packOrSoldAs = input.packOrSoldAs?.trim();
    if (!packOrSoldAs && input.productTypeId) {
      packOrSoldAs = await this.resolvePackOrSoldAs(input.productTypeId, requestedAttributes, input.packOrSoldAs);
    }
    if (!packOrSoldAs && isMedical) {
      const parts = [input.packSize?.trim(), input.packagingType?.trim() || input.unitOfSale?.trim()].filter(Boolean);
      packOrSoldAs = parts.length ? parts.join(' ') : input.unitOfSale?.trim() || 'Unit';
    }
    if (!packOrSoldAs) throw new AppError('Pack size is required', 400);

    if (input.quantity == null || input.quantity < 0) {
      throw new AppError('Stock quantity is required and must be 0 or greater', 400);
    }

    if (!input.manufacturerName?.trim()) {
      throw new AppError('Manufacturer company name is required', 400);
    }
    if (!input.manufacturerAddress?.trim()) {
      throw new AppError('Manufacturer address is required', 400);
    }
    let resolvedSubcategoryId = input.subcategoryId && mongoose.Types.ObjectId.isValid(input.subcategoryId)
      ? new mongoose.Types.ObjectId(input.subcategoryId)
      : undefined;

    let resolvedProductTypeId = input.productTypeId && mongoose.Types.ObjectId.isValid(input.productTypeId)
      ? new mongoose.Types.ObjectId(input.productTypeId)
      : undefined;

    if (isMedical) {
      if (!resolvedSubcategoryId) {
        const subcatCandidates = [input.medicalSubcategory?.trim(), input.medicalCategory?.trim()].filter(Boolean) as string[];
        for (const candidate of subcatCandidates) {
          const escaped = candidate.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
          const matchedSubcat = await Subcategory.findOne({
            categoryId: resolvedCategoryId,
            name: { $regex: new RegExp(`^${escaped}$`, 'i') },
          }).select('_id');
          if (matchedSubcat) {
            resolvedSubcategoryId = matchedSubcat._id;
            break;
          }
        }
      }

      if (!resolvedProductTypeId && resolvedSubcategoryId) {
        const ptCandidates = [
          input.productType?.trim(),
          input.dosageForm?.trim(),
        ].filter(Boolean) as string[];

        for (const candidate of ptCandidates) {
          const escaped = candidate.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
          const matchedPt = await ProductType.findOne({
            subcategoryId: resolvedSubcategoryId,
            name: { $regex: new RegExp(`^${escaped}$`, 'i') },
          }).select('_id');
          if (matchedPt) {
            resolvedProductTypeId = matchedPt._id;
            break;
          }
        }

        if (!resolvedProductTypeId) {
          const firstPt = await ProductType.findOne({
            subcategoryId: resolvedSubcategoryId,
            status: 'ACTIVE',
          }).sort({ displayOrder: 1 }).select('_id');
          if (firstPt) {
            resolvedProductTypeId = firstPt._id;
          }
        }
      }
    }

    const ingredients = input.ingredientsImageUrl?.trim();

    return ProductSubmission.create({
      sellerId,
      submittedProductName: input.name.trim(),
      categoryId: resolvedCategoryId,
      brand: input.brand?.trim(),
      description: input.description?.trim(),
      manufacturerName: input.manufacturerName?.trim(),
      manufacturerAddress: input.manufacturerAddress?.trim(),
      subcategoryId: resolvedSubcategoryId,
      productTypeId: resolvedProductTypeId,
      packOrSoldAs,
      sellingPricePaise: Math.round(input.sellingPricePaise),
      quantity: Math.round(input.quantity),
      lifespanValue:
        input.lifespanValue != null && input.lifespanValue >= 0
          ? Math.round(input.lifespanValue)
          : undefined,
      lifespanUnit: input.lifespanUnit?.trim(),
      photoUrl: front,
      frontImageUrl: front,
      ingredientsImageUrl: ingredients,
      requestedAttributes,
      images: [...new Set([front, ...uploadedImages, ingredients].filter(Boolean))] as string[],
      status: 'PENDING',

      // Medical fields
      isMedicalProduct: isMedical,
      productType: input.productType?.trim(),
      medicalCategory: input.medicalCategory?.trim(),
      medicalSubcategory: input.medicalSubcategory?.trim(),
      genericName: input.genericName?.trim(),
      dosageForm: input.dosageForm?.trim(),
      routeOfAdmin: input.routeOfAdmin?.trim(),
      strength: input.strength?.trim(),
      strengthUnit: input.strengthUnit?.trim(),
      packSize: input.packSize?.trim(),
      packagingType: input.packagingType?.trim(),
      netContent: input.netContent?.trim(),
      releaseType: input.releaseType?.trim(),
      productForm: input.productForm?.trim(),
      indication: input.indication?.trim(),
      directionsForUse: input.directionsForUse?.trim(),
      keyBenefits: input.keyBenefits?.trim(),
      keyIngredients: input.keyIngredients?.trim(),
      safetyInfo: input.safetyInfo?.trim(),
      sideEffects: input.sideEffects?.trim(),
      allergenInfo: input.allergenInfo?.trim(),
      storageCondition: input.storageCondition?.trim(),
      disclaimer: input.disclaimer?.trim(),
      sterility: input.sterility?.trim(),
      useType: input.useType?.trim(),
      marketerName: input.marketerName?.trim(),
      countryOfOrigin: input.countryOfOrigin?.trim(),
      licenceNumber: input.licenceNumber?.trim(),
      prescriptionCategory: input.prescriptionCategory?.trim(),
      regulatoryInfo: input.regulatoryInfo?.trim(),
      mrpPaise: input.mrpPaise != null ? Math.round(input.mrpPaise) : undefined,
      unitOfSale: input.unitOfSale?.trim(),
      batchNumber: input.batchNumber?.trim(),
      mfgDate: input.mfgDate?.trim(),
      expiryDate: input.expiryDate?.trim(),
      rackLocation: input.rackLocation?.trim(),
      coldChainRequired: Boolean(input.coldChainRequired),
      prescriptionRequired: Boolean(input.prescriptionRequired),
      prescriptionDocUrl: input.prescriptionDocUrl?.trim(),
      additionalNotes: input.additionalNotes?.trim(),
    });
  }

  /**
   * Submit several product requests in one call. Each item carries its own
   * category. Items that fail validation are reported back by name instead of
   * failing the whole batch.
   */
  static async createRequestsBulk(
    sellerId: string,
    body: {
      items: Array<{
        name: string;
        categoryId: string;
        packOrSoldAs?: string;
        sellingPricePaise?: number;
        quantity?: number;
        lifespanValue?: number;
        lifespanUnit?: string;
        photoUrl?: string;
        frontImageUrl?: string;
        ingredientsImageUrl?: string;
        brand?: string;
        description?: string;
        manufacturerName?: string;
        manufacturerAddress?: string;
      }>;
    },
  ): Promise<{ created: number; failed: Array<{ name: string; reason: string }>; requested: number }> {
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw new AppError('No items provided', 400);
    if (items.length > 50) throw new AppError('Too many items — 50 per batch max', 400);

    const categoryIds = [...new Set(items.map((i) => i.categoryId).filter(Boolean))];
    const foundCats = await Category.find({ _id: { $in: categoryIds } }).select('_id').lean();
    const validCategory = new Set(foundCats.map((c) => String(c._id)));

    const failed: Array<{ name: string; reason: string }> = [];
    const docs = items.reduce<Record<string, unknown>[]>((acc, it) => {
      const name = (it.name || '').trim();
      if (name.length < 2) {
        failed.push({ name: it.name || '(blank)', reason: 'Name too short' });
        return acc;
      }
      if (!it.categoryId || !validCategory.has(String(it.categoryId))) {
        failed.push({ name, reason: 'Unknown category' });
        return acc;
      }
      if (it.sellingPricePaise == null || it.sellingPricePaise <= 0) {
        failed.push({ name, reason: 'Price is required and must be greater than 0' });
        return acc;
      }
      if (!it.packOrSoldAs?.trim()) {
        failed.push({ name, reason: 'Pack size is required' });
        return acc;
      }
      if (it.quantity == null || it.quantity < 0) {
        failed.push({ name, reason: 'Stock quantity is required and must be 0 or greater' });
        return acc;
      }
      if (!it.manufacturerName?.trim()) {
        failed.push({ name, reason: 'Manufacturer company name is required' });
        return acc;
      }
      if (!it.manufacturerAddress?.trim()) {
        failed.push({ name, reason: 'Manufacturer address is required' });
        return acc;
      }
      const front = it.frontImageUrl?.trim() || it.photoUrl?.trim();
      const ingredients = it.ingredientsImageUrl?.trim();
      acc.push({
        sellerId,
        submittedProductName: name,
        categoryId: it.categoryId,
        brand: it.brand?.trim(),
        description: it.description?.trim(),
        manufacturerName: it.manufacturerName?.trim(),
        manufacturerAddress: it.manufacturerAddress?.trim(),
        packOrSoldAs: it.packOrSoldAs.trim(),
        sellingPricePaise: Math.round(it.sellingPricePaise),
        quantity: Math.round(it.quantity),
        lifespanValue:
          it.lifespanValue != null && it.lifespanValue >= 0
            ? Math.round(it.lifespanValue)
            : undefined,
        lifespanUnit: it.lifespanUnit?.trim(),
        photoUrl: front,
        frontImageUrl: front,
        ingredientsImageUrl: ingredients,
        requestedAttributes: [],
        images: [front, ingredients].filter(Boolean) as string[],
        status: 'PENDING',
      });
      return acc;
    }, []);

    let created = 0;
    if (docs.length) {
      try {
        const inserted = await ProductSubmission.insertMany(docs, { ordered: false });
        created = inserted.length;
      } catch (e) {
        // ordered:false still inserts the valid docs; fold the rest into `failed`.
        const err = e as { insertedDocs?: Array<{ submittedProductName?: string }> };
        const insertedDocs = err.insertedDocs ?? [];
        const insertedNames = new Set(insertedDocs.map((d) => d.submittedProductName));
        created = insertedDocs.length;
        for (const d of docs) {
          const n = d.submittedProductName as string;
          if (!insertedNames.has(n)) failed.push({ name: n, reason: 'Could not be saved' });
        }
      }
    }

    return { created, failed, requested: items.length };
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
      subcategoryId?: string;
      productTypeId?: string;
      requestedAttributes?: ProductAttributeValue[];
      packOrSoldAs?: string;
      sellingPricePaise?: number;
      quantity?: number;
      lifespanValue?: number;
      lifespanUnit?: string;
      photoUrl?: string;
      frontImageUrl?: string;
      ingredientsImageUrl?: string;
      brand?: string;
      description?: string;
      manufacturerName?: string;
      manufacturerAddress?: string;

      /** Medical fields */
      isMedicalProduct?: boolean;
      productType?: string;
      medicalCategory?: string;
      medicalSubcategory?: string;
      genericName?: string;
      dosageForm?: string;
      routeOfAdmin?: string;
      strength?: string;
      strengthUnit?: string;
      packSize?: string;
      packagingType?: string;
      netContent?: string;
      releaseType?: string;
      productForm?: string;
      indication?: string;
      directionsForUse?: string;
      keyBenefits?: string;
      keyIngredients?: string;
      safetyInfo?: string;
      sideEffects?: string;
      allergenInfo?: string;
      storageCondition?: string;
      disclaimer?: string;
      sterility?: string;
      useType?: string;
      marketerName?: string;
      countryOfOrigin?: string;
      licenceNumber?: string;
      prescriptionCategory?: string;
      regulatoryInfo?: string;
      mrpPaise?: number;
      unitOfSale?: string;
      batchNumber?: string;
      mfgDate?: string;
      expiryDate?: string;
      rackLocation?: string;
      coldChainRequired?: boolean;
      prescriptionRequired?: boolean;
      prescriptionDocUrl?: string;
      additionalNotes?: string;
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
    const nextSubcategoryId = patch.subcategoryId || submission.subcategoryId?.toString();
    const nextProductTypeId = patch.productTypeId || submission.productTypeId?.toString();
    if (patch.subcategoryId || patch.productTypeId || patch.requestedAttributes) {
      if (!nextSubcategoryId || !nextProductTypeId) {
        throw new AppError('Subcategory and product type are required', 400);
      }
      await this.assertHierarchy(submission.categoryId.toString(), nextSubcategoryId, nextProductTypeId);
      submission.subcategoryId = nextSubcategoryId as never;
      submission.productTypeId = nextProductTypeId as never;
      submission.requestedAttributes = await this.validateRequestedAttributes(
        nextProductTypeId,
        patch.requestedAttributes || submission.requestedAttributes || [],
      );
    }
    if (patch.packOrSoldAs !== undefined) {
      if (!patch.packOrSoldAs.trim()) {
        throw new AppError('Pack size is required', 400);
      }
      submission.packOrSoldAs = patch.packOrSoldAs.trim();
    }
    if (patch.requestedAttributes && nextProductTypeId) {
      const derivedPack = await this.resolvePackOrSoldAs(nextProductTypeId, patch.requestedAttributes, patch.packOrSoldAs);
      if (derivedPack) submission.packOrSoldAs = derivedPack;
    }
    if (patch.sellingPricePaise !== undefined) {
      if (patch.sellingPricePaise == null || patch.sellingPricePaise <= 0) {
        throw new AppError('Price is required and must be greater than 0', 400);
      }
      submission.sellingPricePaise = Math.round(patch.sellingPricePaise);
    }
    if (patch.quantity !== undefined) {
      if (patch.quantity == null || patch.quantity < 0) {
        throw new AppError('Stock quantity must be 0 or greater', 400);
      }
      submission.quantity = Math.round(patch.quantity);
    }
    if (patch.lifespanValue != null && patch.lifespanValue >= 0) {
      submission.lifespanValue = Math.round(patch.lifespanValue);
    }
    if (patch.lifespanUnit !== undefined) {
      submission.lifespanUnit = patch.lifespanUnit?.trim();
    }
    if (patch.frontImageUrl !== undefined) {
      submission.frontImageUrl = patch.frontImageUrl;
      submission.photoUrl = patch.frontImageUrl;
    } else if (patch.photoUrl !== undefined) {
      submission.photoUrl = patch.photoUrl;
      submission.frontImageUrl = patch.photoUrl;
    }
    if (patch.ingredientsImageUrl !== undefined) {
      submission.ingredientsImageUrl = patch.ingredientsImageUrl;
    }
    submission.images = [submission.frontImageUrl || submission.photoUrl, submission.ingredientsImageUrl].filter(Boolean) as string[];
    if (patch.brand !== undefined) submission.brand = patch.brand.trim();
    if (patch.description !== undefined) submission.description = patch.description.trim();
    if (patch.manufacturerName !== undefined) submission.manufacturerName = patch.manufacturerName.trim();
    if (patch.manufacturerAddress !== undefined) submission.manufacturerAddress = patch.manufacturerAddress.trim();

    // Medical patch fields
    if (patch.isMedicalProduct !== undefined) submission.isMedicalProduct = patch.isMedicalProduct;
    if (patch.productType !== undefined) submission.productType = patch.productType.trim();
    if (patch.medicalCategory !== undefined) submission.medicalCategory = patch.medicalCategory.trim();
    if (patch.medicalSubcategory !== undefined) submission.medicalSubcategory = patch.medicalSubcategory.trim();
    if (patch.genericName !== undefined) submission.genericName = patch.genericName.trim();
    if (patch.dosageForm !== undefined) submission.dosageForm = patch.dosageForm.trim();
    if (patch.routeOfAdmin !== undefined) submission.routeOfAdmin = patch.routeOfAdmin.trim();
    if (patch.strength !== undefined) submission.strength = patch.strength.trim();
    if (patch.strengthUnit !== undefined) submission.strengthUnit = patch.strengthUnit.trim();
    if (patch.packSize !== undefined) submission.packSize = patch.packSize.trim();
    if (patch.packagingType !== undefined) submission.packagingType = patch.packagingType.trim();
    if (patch.netContent !== undefined) submission.netContent = patch.netContent.trim();
    if (patch.releaseType !== undefined) submission.releaseType = patch.releaseType.trim();
    if (patch.productForm !== undefined) submission.productForm = patch.productForm.trim();
    if (patch.indication !== undefined) submission.indication = patch.indication.trim();
    if (patch.directionsForUse !== undefined) submission.directionsForUse = patch.directionsForUse.trim();
    if (patch.keyBenefits !== undefined) submission.keyBenefits = patch.keyBenefits.trim();
    if (patch.keyIngredients !== undefined) submission.keyIngredients = patch.keyIngredients.trim();
    if (patch.safetyInfo !== undefined) submission.safetyInfo = patch.safetyInfo.trim();
    if (patch.sideEffects !== undefined) submission.sideEffects = patch.sideEffects.trim();
    if (patch.allergenInfo !== undefined) submission.allergenInfo = patch.allergenInfo.trim();
    if (patch.storageCondition !== undefined) submission.storageCondition = patch.storageCondition.trim();
    if (patch.disclaimer !== undefined) submission.disclaimer = patch.disclaimer.trim();
    if (patch.sterility !== undefined) submission.sterility = patch.sterility.trim();
    if (patch.useType !== undefined) submission.useType = patch.useType.trim();
    if (patch.marketerName !== undefined) submission.marketerName = patch.marketerName.trim();
    if (patch.countryOfOrigin !== undefined) submission.countryOfOrigin = patch.countryOfOrigin.trim();
    if (patch.licenceNumber !== undefined) submission.licenceNumber = patch.licenceNumber.trim();
    if (patch.prescriptionCategory !== undefined) submission.prescriptionCategory = patch.prescriptionCategory.trim();
    if (patch.regulatoryInfo !== undefined) submission.regulatoryInfo = patch.regulatoryInfo.trim();
    if (patch.mrpPaise !== undefined) submission.mrpPaise = patch.mrpPaise != null ? Math.round(patch.mrpPaise) : undefined;
    if (patch.unitOfSale !== undefined) submission.unitOfSale = patch.unitOfSale.trim();
    if (patch.batchNumber !== undefined) submission.batchNumber = patch.batchNumber.trim();
    if (patch.mfgDate !== undefined) submission.mfgDate = patch.mfgDate.trim();
    if (patch.expiryDate !== undefined) submission.expiryDate = patch.expiryDate.trim();
    if (patch.rackLocation !== undefined) submission.rackLocation = patch.rackLocation.trim();
    if (patch.coldChainRequired !== undefined) submission.coldChainRequired = Boolean(patch.coldChainRequired);
    if (patch.prescriptionRequired !== undefined) submission.prescriptionRequired = Boolean(patch.prescriptionRequired);
    if (patch.prescriptionDocUrl !== undefined) submission.prescriptionDocUrl = patch.prescriptionDocUrl.trim();
    if (patch.additionalNotes !== undefined) submission.additionalNotes = patch.additionalNotes.trim();
    submission.status = 'PENDING';
    submission.adminComment = undefined;
    await submission.save();

    // If this submission is for a Master Catalogue product (has mappedMasterProductId),
    // re-create or update the SellerListing with UNDER_REVIEW status so it appears in the seller's store!
    if (submission.mappedMasterProductId && submission.sellerId) {
      const listingPrice = submission.sellingPricePaise ?? 0;
      const initialStock = submission.quantity ?? 0;
      const unitVal = submission.packOrSoldAs || submission.unitOfSale || undefined;
      const customProductInformation: Record<string, any> = {
        ...(submission.batchNumber ? { batchNumber: submission.batchNumber } : {}),
        ...(submission.expiryDate ? { expiryDate: submission.expiryDate } : {}),
        ...(submission.mfgDate ? { mfgDate: submission.mfgDate } : {}),
        ...(submission.rackLocation ? { rackLocation: submission.rackLocation } : {}),
        ...(submission.mrpPaise != null ? { mrpPaise: submission.mrpPaise } : {}),
      };

      const listing = await SellerListing.findOneAndUpdate(
        {
          sellerId: submission.sellerId,
          masterProductId: submission.mappedMasterProductId,
        },
        {
          sellerId: submission.sellerId,
          masterProductId: submission.mappedMasterProductId,
          sellingPricePaise: Math.round(listingPrice),
          pendingSellingPricePaise: Math.round(listingPrice),
          stock: initialStock,
          reserved: 0,
          status: 'ACTIVE',
          availability: initialStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
          reviewStatus: 'UNDER_REVIEW',
          reviewSubmittedAt: new Date(),
          unit: unitVal,
          pendingUnit: unitVal,
          customDescription: submission.description || undefined,
          pendingDescription: submission.description || undefined,
          ...(Object.keys(customProductInformation).length ? {
            customProductInformation,
            pendingProductInformation: customProductInformation,
          } : {}),
        },
        { upsert: true, new: true },
      );

      await ShopInventory.findOneAndUpdate(
        { sellerId: submission.sellerId, listingId: listing._id },
        {
          sellerId: submission.sellerId,
          listingId: listing._id,
          masterProductId: submission.mappedMasterProductId,
          stock: initialStock,
          reserved: 0,
        },
        { upsert: true, new: true },
      );
    }

    return submission;
  }

  static async requestReadd(sellerId: string, id: string) {
    const submission = await ProductSubmission.findById(id);
    if (!submission) throw new AppError('Product request not found', 404);
    if (submission.sellerId.toString() !== sellerId) throw new AppError('Not your request', 403);

    submission.status = 'PENDING';
    submission.reviewedBy = undefined;
    submission.reviewedAt = undefined;
    submission.adminComment = 'Re-added by seller; pending admin review.';
    await submission.save();

    let masterProductId = submission.mappedMasterProductId?.toString();
    if (!masterProductId) {
      const existingMaster = await MasterProduct.findOne({
        $or: [
          ...(submission.submittedProductName ? [{ name: submission.submittedProductName }] : []),
          ...((submission as any).name ? [{ name: (submission as any).name }] : []),
          ...((submission as any).sku ? [{ sku: (submission as any).sku }] : []),
        ],
      });
      if (existingMaster) {
        masterProductId = existingMaster._id.toString();
        submission.mappedMasterProductId = existingMaster._id;
        await submission.save();
      }
    }

    if (masterProductId) {
      const listingPrice = submission.sellingPricePaise ?? 0;
      const initialStock = Math.max(0, Math.round(Number(submission.quantity) || 0));

      const customProductInformation: Record<string, any> = {
        ...(submission.isMedicalProduct || submission.genericName ? {
          genericName: submission.genericName,
          dosageForm: submission.dosageForm,
          routeOfAdmin: submission.routeOfAdmin,
          strength: submission.strength ? `${submission.strength} ${submission.strengthUnit || ''}`.trim() : undefined,
          prescriptionCategory: submission.prescriptionCategory,
          batchNumber: submission.batchNumber,
          mfgDate: submission.mfgDate,
          expiryDate: submission.expiryDate,
          rackLocation: submission.rackLocation,
          coldChainRequired: submission.coldChainRequired ?? false,
          prescriptionRequired: submission.prescriptionRequired ?? false,
          mrpPaise: submission.mrpPaise,
          unitOfSale: submission.unitOfSale || submission.packOrSoldAs,
          prescriptionDocUrl: submission.prescriptionDocUrl,
          sideEffects: submission.sideEffects,
          indication: submission.indication,
          safetyInfo: submission.safetyInfo,
          marketerName: submission.marketerName,
          countryOfOrigin: submission.countryOfOrigin,
          licenceNumber: submission.licenceNumber,
          regulatoryInfo: submission.regulatoryInfo,
        } : {
          ...(submission.lifespanValue != null ? {
            lifespanValue: submission.lifespanValue,
            lifespanUnit: submission.lifespanUnit || 'Days',
          } : {}),
          ...(submission.manufacturerName ? { manufacturer: submission.manufacturerName } : {}),
          ...(submission.manufacturerAddress ? { manufacturerAddress: submission.manufacturerAddress } : {}),
        }),
      };

      const listing = await SellerListing.findOneAndUpdate(
        { sellerId: submission.sellerId, masterProductId },
        {
          sellerId: submission.sellerId,
          masterProductId,
          sellingPricePaise: Math.round(listingPrice),
          pendingSellingPricePaise: Math.round(listingPrice),
          stock: initialStock,
          reserved: 0,
          status: 'ACTIVE',
          availability: initialStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
          reviewStatus: 'UNDER_REVIEW',
          reviewSubmittedAt: new Date(),
          unit: submission.packOrSoldAs || submission.unitOfSale || undefined,
          customDescription: submission.description || undefined,
          ...(Object.keys(customProductInformation).length ? {
            customProductInformation,
            pendingProductInformation: customProductInformation,
          } : {}),
        },
        { upsert: true, new: true },
      );

      await ShopInventory.findOneAndUpdate(
        { sellerId: submission.sellerId, listingId: listing._id },
        {
          sellerId: submission.sellerId,
          listingId: listing._id,
          masterProductId,
          stock: initialStock,
          reserved: 0,
        },
        { upsert: true, new: true },
      );
    }

    return submission;
  }

  static async addToMasterCatalogue(id: string, adminId: string) {
    const submission = await ProductSubmission.findById(id);
    if (!submission) throw new AppError('Submission not found', 404);
    if (!submission.mappedMasterProductId) {
      throw new AppError('Submission does not have a mapped master product', 400);
    }
    const masterProduct = await MasterProduct.findByIdAndUpdate(
      submission.mappedMasterProductId,
      { status: 'ACTIVE', updatedBy: adminId },
      { new: true },
    );
    if (!masterProduct) throw new AppError('Master product not found', 404);
    return { submission, masterProduct };
  }

  static async delete(id: string) {
    const submission = await ProductSubmission.findById(id);
    if (!submission) throw new AppError('Submission not found', 404);

    // If this submission was APPROVED and created a listing for the seller's store, delete the listing & inventory
    if (submission.mappedMasterProductId && submission.sellerId) {
      const listing = await SellerListing.findOne({
        sellerId: submission.sellerId,
        masterProductId: submission.mappedMasterProductId,
      });

      if (listing) {
        await ShopInventory.deleteMany({ sellerId: submission.sellerId, listingId: listing._id });
        await SellerListing.deleteOne({ _id: listing._id });
      }
    }

    submission.status = 'DELETED';
    submission.adminComment = 'Product submission deleted by admin.';
    await submission.save();

    return { success: true, message: 'Submission status set to DELETED and seller store listing removed' };
  }
}




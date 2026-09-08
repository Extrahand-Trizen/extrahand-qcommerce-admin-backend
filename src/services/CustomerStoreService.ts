import MasterProduct from '../models/MasterProduct';
import CustomerCart from '../models/CustomerCart';
import CustomerWishlist from '../models/CustomerWishlist';
import SellerListing from '../models/SellerListing';
import { Types } from 'mongoose';
import { StorefrontService, StoreProduct, StorefrontQuery } from './StorefrontService';
import { STOREFRONT_LISTING_MATCH } from './storefront/storefrontListingQueries';
import { AppError } from '../utils/response';

export type CustomerCartItemDTO = {
  productSlug: string;
  quantity: number;
  product: StoreProduct;
};

export type CustomerCartDTO = {
  sellerId?: string;
  items: CustomerCartItemDTO[];
};

export type CustomerWishlistItemDTO = {
  productSlug: string;
  product: StoreProduct;
};

async function resolveMasterProduct(slug: string) {
  const product = await MasterProduct.findOne({ slug: slug.trim(), status: 'ACTIVE' });
  if (!product) throw new AppError('Product not found', 404);
  return product;
}

async function enrichCartItems(
  items: Array<{ productSlug: string; quantity: number }>,
  query: StorefrontQuery,
): Promise<CustomerCartItemDTO[]> {
  const slugs = items.map((item) => item.productSlug);
  const productMap = await StorefrontService.resolveProductsBySlugs(slugs, query);

  const enriched: CustomerCartItemDTO[] = [];
  for (const item of items) {
    const product = productMap.get(item.productSlug);
    if (!product) continue;
    enriched.push({
      productSlug: item.productSlug,
      quantity: item.quantity,
      product,
    });
  }
  return enriched;
}

async function enrichWishlistItems(
  items: Array<{ productSlug: string }>,
  query: StorefrontQuery,
): Promise<CustomerWishlistItemDTO[]> {
  const slugs = items.map((item) => item.productSlug);
  const productMap = await StorefrontService.resolveProductsBySlugs(slugs, query);

  const enriched: CustomerWishlistItemDTO[] = [];
  for (const item of items) {
    const product = productMap.get(item.productSlug);
    if (!product) continue;
    enriched.push({
      productSlug: item.productSlug,
      product,
    });
  }
  return enriched;
}

async function assertSellerListing(
  sellerId: Types.ObjectId,
  masterProductId: Types.ObjectId,
  productSlug: string,
) {
  const listing = await SellerListing.findOne({
    sellerId,
    masterProductId,
    ...STOREFRONT_LISTING_MATCH,
  })
    .select('availability')
    .lean();

  if (!listing) {
    throw new AppError(`${productSlug} is not available from this store`, 409, {
      code: 'PRODUCT_NOT_AT_STORE',
    });
  }

  const inStock = listing.availability === 'AVAILABLE' || listing.availability === 'LIMITED';
  if (!inStock) {
    throw new AppError(`${productSlug} is out of stock at this store`, 409, {
      code: 'PRODUCT_OUT_OF_STOCK',
    });
  }
}

export class CustomerStoreService {
  static async getCart(userId: string, query: StorefrontQuery = {}): Promise<CustomerCartDTO> {
    const cart = await CustomerCart.findOne({ userId }).lean();
    const items = cart?.items ?? [];
    // Stock against the customer's current location / nearby store — not the cart's
    // original seller pin — so location changes surface Out of stock correctly.
    return {
      sellerId: cart?.sellerId?.toString(),
      items: await enrichCartItems(
        items.map((item) => ({ productSlug: item.productSlug, quantity: item.quantity })),
        query,
      ),
    };
  }

  static async upsertCartItem(
    userId: string,
    input: { productSlug: string; quantity: number },
    query: StorefrontQuery = {},
  ): Promise<CustomerCartDTO> {
    const slug = input.productSlug.trim();
    const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));
    const masterProduct = await resolveMasterProduct(slug);

    const resolved = await StorefrontService.resolveStorefrontSeller(query);
    if (!resolved.serviceable || !resolved.sellerId) {
      throw new AppError('Store is not available at this location', 409, {
        code: 'STORE_UNSERVICEABLE',
      });
    }

    const productMap = await StorefrontService.resolveProductsBySlugs([slug], query);
    const storeProduct = productMap.get(slug);
    if (!storeProduct?.inStock || !storeProduct?.purchasable) {
      throw new AppError(`"${masterProduct.name}" is currently out of stock`, 409);
    }
    if (storeProduct.availableQuantity != null && quantity > storeProduct.availableQuantity) {
      throw new AppError(
        `Cannot add ${quantity} units. Only ${storeProduct.availableQuantity} available in this shop.`,
        409,
      );
    }

    const cart =
      (await CustomerCart.findOne({ userId })) ??
      (await CustomerCart.create({ userId, items: [] }));

    if (cart.sellerId && cart.items.length > 0 && !cart.sellerId.equals(resolved.sellerId)) {
      throw new AppError(
        'Your cart belongs to another store. Clear the cart to shop from this store.',
        409,
        {
          code: 'CART_SELLER_MISMATCH',
          existingSellerId: cart.sellerId.toString(),
          requestedSellerId: resolved.sellerId.toString(),
        },
      );
    }

    await assertSellerListing(resolved.sellerId, masterProduct._id, slug);

    cart.sellerId = resolved.sellerId;

    const index = cart.items.findIndex((item) => item.productSlug === slug);
    if (index >= 0) {
      cart.items[index].quantity = quantity;
      cart.items[index].masterProductId = masterProduct._id;
    } else {
      cart.items.push({
        productSlug: slug,
        masterProductId: masterProduct._id,
        quantity,
      });
    }

    await cart.save();
    return this.getCart(userId, { ...query, sellerId: resolved.sellerId.toString() });
  }

  static async updateCartItemQuantity(
    userId: string,
    productSlug: string,
    quantity: number,
    query: StorefrontQuery = {},
  ): Promise<CustomerCartDTO> {
    const slug = productSlug.trim();
    const nextQuantity = Math.floor(Number(quantity) || 0);
    const cart = await CustomerCart.findOne({ userId });
    if (!cart) throw new AppError('Cart item not found', 404);

    if (nextQuantity <= 0) {
      cart.items = cart.items.filter((item) => item.productSlug !== slug);
      if (!cart.items.length) cart.sellerId = undefined;
      await cart.save();
      return this.getCart(userId, query);
    }

    const item = cart.items.find((entry) => entry.productSlug === slug);
    if (!item) throw new AppError('Cart item not found', 404);

    const productMap = await StorefrontService.resolveProductsBySlugs([slug], query);
    const storeProduct = productMap.get(slug);
    if (!storeProduct?.inStock || !storeProduct?.purchasable) {
      throw new AppError(`"${slug}" is currently out of stock`, 409);
    }
    if (storeProduct.availableQuantity != null && nextQuantity > storeProduct.availableQuantity) {
      throw new AppError(
        `Cannot update to ${nextQuantity} units. Only ${storeProduct.availableQuantity} available in this shop.`,
        409,
      );
    }

    item.quantity = nextQuantity;
    await cart.save();
    return this.getCart(userId, query);
  }

  static async removeCartItem(
    userId: string,
    productSlug: string,
    query: StorefrontQuery = {},
  ): Promise<CustomerCartDTO> {
    const slug = productSlug.trim();
    const cart = await CustomerCart.findOne({ userId });
    if (!cart) return { items: [] as CustomerCartItemDTO[] };

    cart.items = cart.items.filter((item) => item.productSlug !== slug);
    if (!cart.items.length) cart.sellerId = undefined;
    await cart.save();
    return this.getCart(userId, query);
  }

  static async clearCart(userId: string): Promise<CustomerCartDTO> {
    await CustomerCart.findOneAndUpdate(
      { userId },
      { items: [], $unset: { sellerId: 1 } },
      { upsert: true },
    );
    return { items: [] as CustomerCartItemDTO[] };
  }

  static async getWishlist(userId: string, query: StorefrontQuery = {}) {
    const wishlist = await CustomerWishlist.findOne({ userId }).lean();
    const items = wishlist?.items ?? [];
    return {
      items: await enrichWishlistItems(
        items.map((item) => ({ productSlug: item.productSlug })),
        query,
      ),
    };
  }

  static async addWishlistItem(
    userId: string,
    productSlug: string,
    query: StorefrontQuery = {},
  ) {
    const slug = productSlug.trim();
    const masterProduct = await resolveMasterProduct(slug);

    const wishlist =
      (await CustomerWishlist.findOne({ userId })) ??
      (await CustomerWishlist.create({ userId, items: [] }));

    if (!wishlist.items.some((item) => item.productSlug === slug)) {
      wishlist.items.push({
        productSlug: slug,
        masterProductId: masterProduct._id,
      });
      await wishlist.save();
    }

    return this.getWishlist(userId, query);
  }

  static async removeWishlistItem(
    userId: string,
    productSlug: string,
    query: StorefrontQuery = {},
  ) {
    const slug = productSlug.trim();
    const wishlist = await CustomerWishlist.findOne({ userId });
    if (!wishlist) return { items: [] as CustomerWishlistItemDTO[] };

    wishlist.items = wishlist.items.filter((item) => item.productSlug !== slug);
    await wishlist.save();
    return this.getWishlist(userId, query);
  }

  static async clearWishlist(userId: string) {
    await CustomerWishlist.findOneAndUpdate({ userId }, { items: [] }, { upsert: true });
    return { items: [] as CustomerWishlistItemDTO[] };
  }
}

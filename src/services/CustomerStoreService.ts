import MasterProduct from '../models/MasterProduct';
import CustomerCart from '../models/CustomerCart';
import CustomerWishlist from '../models/CustomerWishlist';
import { StorefrontService, StoreProduct, StorefrontQuery } from './StorefrontService';
import { AppError } from '../utils/response';

export type CustomerCartItemDTO = {
  productSlug: string;
  quantity: number;
  product: StoreProduct;
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

export class CustomerStoreService {
  static async getCart(userId: string, query: StorefrontQuery = {}) {
    const cart = await CustomerCart.findOne({ userId }).lean();
    const items = cart?.items ?? [];
    return {
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
  ) {
    const slug = input.productSlug.trim();
    const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));
    const masterProduct = await resolveMasterProduct(slug);

    const cart =
      (await CustomerCart.findOne({ userId })) ??
      (await CustomerCart.create({ userId, items: [] }));

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
    return this.getCart(userId, query);
  }

  static async updateCartItemQuantity(
    userId: string,
    productSlug: string,
    quantity: number,
    query: StorefrontQuery = {},
  ) {
    const slug = productSlug.trim();
    const nextQuantity = Math.floor(Number(quantity) || 0);
    const cart = await CustomerCart.findOne({ userId });
    if (!cart) throw new AppError('Cart item not found', 404);

    if (nextQuantity <= 0) {
      cart.items = cart.items.filter((item) => item.productSlug !== slug);
      await cart.save();
      return this.getCart(userId, query);
    }

    const item = cart.items.find((entry) => entry.productSlug === slug);
    if (!item) throw new AppError('Cart item not found', 404);

    item.quantity = nextQuantity;
    await cart.save();
    return this.getCart(userId, query);
  }

  static async removeCartItem(userId: string, productSlug: string, query: StorefrontQuery = {}) {
    const slug = productSlug.trim();
    const cart = await CustomerCart.findOne({ userId });
    if (!cart) return { items: [] as CustomerCartItemDTO[] };

    cart.items = cart.items.filter((item) => item.productSlug !== slug);
    await cart.save();
    return this.getCart(userId, query);
  }

  static async clearCart(userId: string) {
    await CustomerCart.findOneAndUpdate({ userId }, { items: [] }, { upsert: true });
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

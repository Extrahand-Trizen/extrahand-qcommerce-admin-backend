/**
 * Sample master products for Fresh & Daily Essentials → Fruits & Vegetables.
 */

export type MasterProductSeed = {
  name: string;
  sku: string;
  productTypeSlug: string;
  brand?: string;
  description?: string;
  imageUrl?: string;
  sellingPrice: number;
  compareAtPrice?: number;
  attributes: {
    variety?: string;
    weight: string;
    sold_as: string;
    organic: boolean;
  };
};

const CATEGORY_SLUG = 'fresh';
const SUBCATEGORY_SLUG = 'fruits-veg';

export const FRESH_FRUITS_VEG_MASTER_PRODUCTS: MasterProductSeed[] = [
  {
    name: 'Fresh Apple',
    sku: 'MP-FRESH-APPLE-001',
    productTypeSlug: 'fruits-veg-fresh-fruits',
    brand: 'Local Farm',
    description: 'Crisp and juicy fresh apples, hand-picked for quality.',
    imageUrl: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=400&q=80',
    sellingPrice: 129,
    compareAtPrice: 149,
    attributes: { variety: 'Royal Gala', weight: '1 kg', sold_as: 'Pack', organic: false },
  },
  {
    name: 'Fresh Banana',
    sku: 'MP-FRESH-BANANA-001',
    productTypeSlug: 'fruits-veg-fresh-fruits',
    brand: 'Local Farm',
    description: 'Ripe bananas, perfect for snacking and smoothies.',
    imageUrl: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=400&q=80',
    sellingPrice: 48,
    compareAtPrice: 55,
    attributes: { variety: 'Robusta', weight: '1 kg', sold_as: 'Pack', organic: false },
  },
  {
    name: 'Fresh Orange',
    sku: 'MP-FRESH-ORANGE-001',
    productTypeSlug: 'fruits-veg-fresh-fruits',
    brand: 'Local Farm',
    description: 'Sweet and tangy fresh oranges, rich in vitamin C.',
    imageUrl: 'https://images.unsplash.com/photo-1547514704-6f0f5c0e72a4?auto=format&fit=crop&w=400&q=80',
    sellingPrice: 89,
    compareAtPrice: 99,
    attributes: { variety: 'Valencia', weight: '1 kg', sold_as: 'Pack', organic: false },
  },
  {
    name: 'Fresh Mango',
    sku: 'MP-FRESH-MANGO-001',
    productTypeSlug: 'fruits-veg-fresh-fruits',
    brand: 'Local Farm',
    description: 'Seasonal ripe mangoes with rich flavour and aroma.',
    imageUrl: 'https://images.unsplash.com/photo-1553279768-8650a289d6f3?auto=format&fit=crop&w=400&q=80',
    sellingPrice: 199,
    compareAtPrice: 249,
    attributes: { variety: 'Alphonso', weight: '1 kg', sold_as: 'Pack', organic: false },
  },
  {
    name: 'Fresh Tomato',
    sku: 'MP-FRESH-TOMATO-001',
    productTypeSlug: 'fruits-veg-fresh-vegetables',
    brand: 'Local Farm',
    description: 'Farm-fresh tomatoes for salads, curries, and cooking.',
    imageUrl: 'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=400&q=80',
    sellingPrice: 38,
    compareAtPrice: 48,
    attributes: { variety: 'Hybrid', weight: '1 kg', sold_as: 'Pack', organic: false },
  },
  {
    name: 'Fresh Potato',
    sku: 'MP-FRESH-POTATO-001',
    productTypeSlug: 'fruits-veg-fresh-vegetables',
    brand: 'Local Farm',
    description: 'Versatile potatoes ideal for everyday cooking.',
    imageUrl: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=400&q=80',
    sellingPrice: 32,
    compareAtPrice: 40,
    attributes: { variety: 'Regular', weight: '1 kg', sold_as: 'Pack', organic: false },
  },
  {
    name: 'Fresh Onion',
    sku: 'MP-FRESH-ONION-001',
    productTypeSlug: 'fruits-veg-fresh-vegetables',
    brand: 'Local Farm',
    description: 'Fresh onions for daily kitchen use.',
    imageUrl: 'https://images.unsplash.com/photo-1518977956812-cd3dbadaaf31?auto=format&fit=crop&w=400&q=80',
    sellingPrice: 35,
    compareAtPrice: 42,
    attributes: { variety: 'Red', weight: '1 kg', sold_as: 'Pack', organic: false },
  },
  {
    name: 'Fresh Carrot',
    sku: 'MP-FRESH-CARROT-001',
    productTypeSlug: 'fruits-veg-fresh-vegetables',
    brand: 'Local Farm',
    description: 'Crunchy orange carrots, rich in nutrients.',
    imageUrl: 'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?auto=format&fit=crop&w=400&q=80',
    sellingPrice: 45,
    compareAtPrice: 52,
    attributes: { variety: 'Orange', weight: '1 kg', sold_as: 'Pack', organic: false },
  },
  {
    name: 'Fresh Spinach',
    sku: 'MP-FRESH-SPINACH-001',
    productTypeSlug: 'fruits-veg-leafy-vegetables',
    brand: 'Local Farm',
    description: 'Tender leafy spinach, washed and ready to cook.',
    imageUrl: 'https://images.unsplash.com/photo-1576045057995-568b950f7083?auto=format&fit=crop&w=400&q=80',
    sellingPrice: 28,
    compareAtPrice: 35,
    attributes: { variety: 'Baby Spinach', weight: '250 g', sold_as: 'Pack', organic: false },
  },
  {
    name: 'Fresh Coriander',
    sku: 'MP-FRESH-CORIANDER-001',
    productTypeSlug: 'fruits-veg-herbs',
    brand: 'Local Farm',
    description: 'Aromatic fresh coriander leaves for garnishing and cooking.',
    imageUrl: 'https://images.unsplash.com/photo-1618375584129-82b0d2855a6e?auto=format&fit=crop&w=400&q=80',
    sellingPrice: 18,
    compareAtPrice: 22,
    attributes: { variety: 'Regular', weight: '100 g', sold_as: 'Pack', organic: false },
  },
];

export const MASTER_PRODUCT_SEED_META = {
  categorySlug: CATEGORY_SLUG,
  subcategorySlug: SUBCATEGORY_SLUG,
};

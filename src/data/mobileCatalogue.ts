/**
 * Quick Commerce catalogue taxonomy — source of truth for category/subcategory seeds.
 */
export const MOBILE_CATALOGUE = [
  {
    id: 'fresh',
    title: 'Fresh & Daily Essentials',
    imageUrl: 'https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=240&h=240&q=60',
    subcategories: [
      { id: 'fruits-veg', label: 'Fruits & Vegetables', imageUrl: 'https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=560&h=320&q=60' },
      { id: 'dairy', label: 'Dairy', imageUrl: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'bread-eggs', label: 'Bread, Eggs & Bakery', imageUrl: 'https://images.unsplash.com/photo-1498654077810-12c21d4d6dc3?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'meat-fish', label: 'Meat, Fish & Seafood', imageUrl: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=320&h=320&q=60' },
    ],
  },
  {
    id: 'grocery',
    title: 'Grocery & Staples',
    imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=240&h=240&q=60',
    subcategories: [
      { id: 'atta-rice', label: 'Atta, Rice, Oil & Dals', imageUrl: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=560&h=320&q=60' },
      { id: 'masala', label: 'Masala & Dry Fruits', imageUrl: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'breakfast', label: 'Breakfast & Sauces', imageUrl: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'packaged', label: 'Packaged Food', imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=320&h=320&q=60' },
    ],
  },
  {
    id: 'snacks',
    title: 'Snacks & Beverages',
    imageUrl: 'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?auto=format&fit=crop&w=240&h=240&q=60',
    subcategories: [
      { id: 'tea-coffee', label: 'Tea, Coffee & More', imageUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'cold-drinks', label: 'Cold Drinks & Juices', imageUrl: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'munchies', label: 'Munchies', imageUrl: 'https://images.unsplash.com/photo-1599490659213-e2b9527bd087?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'biscuits', label: 'Biscuits & Cookies', imageUrl: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'sweets', label: 'Sweets & Chocolates', imageUrl: 'https://images.unsplash.com/photo-1481391319762-47dff72954d9?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'icecream', label: 'Ice Creams & More', imageUrl: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'frozen', label: 'Frozen Food', imageUrl: 'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?auto=format&fit=crop&w=320&h=320&q=60' },
    ],
  },
  {
    id: 'beauty',
    title: 'Beauty & Grooming',
    imageUrl: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=240&h=240&q=60',
    subcategories: [
      { id: 'personal-care', label: 'Personal Care', imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=560&h=320&q=60' },
      { id: 'skincare', label: 'Skincare', imageUrl: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'makeup', label: 'Makeup & Beauty', imageUrl: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'fragrance', label: 'Fragrance', imageUrl: 'https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'bath-body', label: 'Bath & Body', imageUrl: 'https://images.unsplash.com/photo-1607613009820-a29f7bb81c04?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'haircare', label: 'Haircare', imageUrl: 'https://images.unsplash.com/photo-1522338140262-f46f5913618a?auto=format&fit=crop&w=320&h=320&q=60' },
    ],
  },
  {
    id: 'health',
    title: 'Health & Wellness',
    imageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=240&h=240&q=60',
    subcategories: [
      { id: 'protein', label: 'Protein & Nutrition', imageUrl: 'https://images.unsplash.com/photo-1579722820308-d74e571900a9?auto=format&fit=crop&w=560&h=320&q=60' },
      { id: 'pharmacy', label: 'Pharmacy & Wellness', imageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'feminine', label: 'Feminine Hygiene', imageUrl: 'https://images.unsplash.com/photo-1631549916768-4119b2e5f926?auto=format&fit=crop&w=320&h=320&q=60' },
    ],
  },
  {
    id: 'baby',
    title: 'Baby Care',
    imageUrl: 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?auto=format&fit=crop&w=240&h=240&q=60',
    subcategories: [
      { id: 'baby-care', label: 'Baby Care', imageUrl: 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?auto=format&fit=crop&w=560&h=320&q=60' },
    ],
  },
  {
    id: 'home',
    title: 'Home & Kitchen',
    imageUrl: 'https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=240&h=240&q=60',
    subcategories: [
      { id: 'home-needs', label: 'Home Needs', imageUrl: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'kitchenware', label: 'Kitchenware & Appliances', imageUrl: 'https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=320&h=320&q=60' },
      { id: 'cleaning', label: 'Cleaning Essentials', imageUrl: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=320&h=320&q=60' },
    ],
  },
  {
    id: 'fashion',
    title: 'Fashion & Lifestyle',
    imageUrl: 'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=240&h=240&q=60',
    subcategories: [
      { id: 'apparel', label: 'Apparel', imageUrl: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=560&h=320&q=60' },
      { id: 'jewellery', label: 'Jewellery', imageUrl: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=560&h=320&q=60' },
      { id: 'electronics', label: 'Electronics Store', imageUrl: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=320&h=320&q=60' },
    ],
  },
  {
    id: 'pet',
    title: 'Pet Care',
    imageUrl: 'https://images.unsplash.com/photo-1450778869180-41d0601e046e?auto=format&fit=crop&w=240&h=240&q=60',
    subcategories: [
      { id: 'pet-care', label: 'Pet Care', imageUrl: 'https://images.unsplash.com/photo-1450778869180-41d0601e046e?auto=format&fit=crop&w=320&h=320&q=60' },
    ],
  },
] as const;

/** Subcategories kept in DB for reference but hidden from active catalogue navigation. */
export const INACTIVE_SUBCATEGORY_SLUGS = ['paan'] as const;

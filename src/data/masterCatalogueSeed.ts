import { AttributeType } from '../types';

export type AttributeDef = {
  key: string;
  name: string;
  type: AttributeType;
  options?: string[];
};

/** Global reusable attributes */
export const ATTRIBUTE_DEFS: AttributeDef[] = [
  { key: 'brand', name: 'Brand', type: 'TEXT' },
  { key: 'weight', name: 'Net Weight', type: 'TEXT' },
  { key: 'sold_as', name: 'Sold As', type: 'DROPDOWN', options: ['Pack', 'Loose', 'Piece'] },
  { key: 'unit', name: 'Unit', type: 'DROPDOWN', options: ['g', 'kg', 'ml', 'L', 'pcs', 'Pack'] },
  { key: 'variety', name: 'Variety', type: 'TEXT' },
  { key: 'organic', name: 'Organic', type: 'BOOLEAN' },
  { key: 'country_origin', name: 'Country/Origin', type: 'TEXT' },
  { key: 'pack_size', name: 'Pack Size', type: 'TEXT' },
  { key: 'variant', name: 'Variant', type: 'TEXT' },
  { key: 'quantity', name: 'Quantity', type: 'TEXT' },
  { key: 'fat_content', name: 'Fat Content', type: 'DROPDOWN', options: ['Full Cream', 'Toned', 'Double Toned', 'Skimmed'] },
  { key: 'flavour', name: 'Flavour', type: 'TEXT' },
  { key: 'dietary_type', name: 'Dietary Type', type: 'DROPDOWN', options: ['Vegetarian', 'Vegan', 'Gluten Free', 'Sugar Free'] },
  { key: 'type', name: 'Type', type: 'TEXT' },
  { key: 'egg_size', name: 'Egg Size', type: 'DROPDOWN', options: ['Small', 'Medium', 'Large', 'Extra Large'] },
  { key: 'cut', name: 'Cut', type: 'TEXT' },
  { key: 'fresh_frozen', name: 'Fresh/Frozen', type: 'DROPDOWN', options: ['Fresh', 'Frozen'] },
  { key: 'pieces', name: 'Pieces', type: 'NUMBER' },
  { key: 'packaging_type', name: 'Packaging Type', type: 'DROPDOWN', options: ['Pouch', 'Box', 'Bottle', 'Jar', 'Tin', 'Bag'] },
  { key: 'veg_nonveg', name: 'Vegetarian/Non-Vegetarian', type: 'DROPDOWN', options: ['Vegetarian', 'Non-Vegetarian', 'Egg'] },
  { key: 'shelf_life', name: 'Shelf Life', type: 'TEXT' },
  { key: 'caffeine_type', name: 'Caffeine Type', type: 'DROPDOWN', options: ['Caffeinated', 'Decaf'] },
  { key: 'sugar_type', name: 'Sugar Type', type: 'DROPDOWN', options: ['Regular', 'Zero Sugar', 'Low Sugar'] },
  { key: 'spice_level', name: 'Spice Level', type: 'DROPDOWN', options: ['Mild', 'Medium', 'Hot', 'Extra Hot'] },
  { key: 'fragrance', name: 'Fragrance', type: 'TEXT' },
  { key: 'gender', name: 'Gender', type: 'DROPDOWN', options: ['Men', 'Women', 'Unisex', 'Kids'] },
  { key: 'skin_type', name: 'Skin Type', type: 'DROPDOWN', options: ['Normal', 'Dry', 'Oily', 'Combination', 'Sensitive'] },
  { key: 'spf', name: 'SPF', type: 'TEXT' },
  { key: 'shade', name: 'Shade', type: 'TEXT' },
  { key: 'finish', name: 'Finish', type: 'DROPDOWN', options: ['Matte', 'Glossy', 'Satin', 'Natural'] },
  { key: 'hair_type', name: 'Hair Type', type: 'DROPDOWN', options: ['Normal', 'Dry', 'Oily', 'Damaged', 'Curly', 'Straight'] },
  { key: 'serving_size', name: 'Serving Size', type: 'TEXT' },
  { key: 'size', name: 'Size', type: 'TEXT' },
  { key: 'absorbency', name: 'Absorbency', type: 'DROPDOWN', options: ['Light', 'Regular', 'Heavy', 'Overnight'] },
  { key: 'age_group', name: 'Age Group', type: 'DROPDOWN', options: ['0-6 months', '6-12 months', '1-2 years', '2-5 years', '5+ years'] },
  { key: 'material', name: 'Material', type: 'TEXT' },
  { key: 'colour', name: 'Colour', type: 'TEXT' },
  { key: 'capacity', name: 'Capacity', type: 'TEXT' },
  { key: 'power_wattage', name: 'Power/Wattage', type: 'TEXT' },
  { key: 'model', name: 'Model', type: 'TEXT' },
  { key: 'compatibility', name: 'Compatibility', type: 'TEXT' },
  { key: 'warranty', name: 'Warranty', type: 'TEXT' },
  { key: 'pet_type', name: 'Pet Type', type: 'DROPDOWN', options: ['Dog', 'Cat', 'Bird', 'Fish', 'Other'] },
  { key: 'design', name: 'Design', type: 'TEXT' },
  { key: 'storage_type', name: 'Storage Type', type: 'DROPDOWN', options: ['Frozen', 'Chilled', 'Ambient'] },
];

export type ProductTypeSeed = {
  name: string;
  slug: string;
  attributes: string[];
  required?: string[];
};

export type SubcategoryCatalogueSeed = {
  subcategorySlug: string;
  categorySlug: string;
  productTypes: ProductTypeSeed[];
};

function pt(name: string, slug: string, attributes: string[], required: string[] = ['brand']): ProductTypeSeed {
  const attrs = [...new Set(attributes)];
  const req = required.filter((k) => attrs.includes(k));
  return { name, slug, attributes: attrs, required: req.length ? req : undefined };
}

export const SUBCATEGORY_CATALOGUE: SubcategoryCatalogueSeed[] = [
  {
    categorySlug: 'fresh',
    subcategorySlug: 'fruits-veg',
    productTypes: [
      pt('Fresh Fruits', 'fresh-fruits', ['weight', 'sold_as', 'variety', 'organic', 'country_origin'], ['weight', 'sold_as']),
      pt('Fresh Vegetables', 'fresh-vegetables', ['weight', 'sold_as', 'variety', 'organic', 'country_origin'], ['weight', 'sold_as']),
      pt('Leafy Vegetables', 'leafy-vegetables', ['weight', 'sold_as', 'variety', 'organic'], ['weight', 'sold_as']),
      pt('Herbs', 'herbs', ['weight', 'sold_as', 'variety', 'organic'], ['weight', 'sold_as']),
    ],
  },
  {
    categorySlug: 'fresh',
    subcategorySlug: 'dairy',
    productTypes: [
      pt('Milk', 'milk', ['brand', 'variant', 'quantity', 'pack_size', 'fat_content', 'flavour', 'dietary_type']),
      pt('Curd & Yogurt', 'curd-yogurt', ['brand', 'variant', 'quantity', 'pack_size', 'fat_content', 'flavour', 'dietary_type']),
      pt('Butter', 'butter', ['brand', 'variant', 'quantity', 'pack_size', 'fat_content', 'flavour']),
      pt('Cheese', 'cheese', ['brand', 'variant', 'quantity', 'pack_size', 'fat_content', 'flavour', 'type']),
      pt('Paneer', 'paneer', ['brand', 'variant', 'quantity', 'pack_size', 'fat_content']),
      pt('Cream', 'cream', ['brand', 'variant', 'quantity', 'pack_size', 'fat_content', 'flavour']),
    ],
  },
  {
    categorySlug: 'fresh',
    subcategorySlug: 'bread-eggs',
    productTypes: [
      pt('Bread', 'bread', ['brand', 'type', 'quantity', 'pack_size', 'flavour']),
      pt('Buns & Pav', 'buns-pav', ['brand', 'type', 'quantity', 'pack_size', 'flavour']),
      pt('Eggs', 'eggs', ['brand', 'type', 'quantity', 'pack_size', 'egg_size']),
      pt('Bakery Items', 'bakery-items', ['brand', 'type', 'quantity', 'pack_size', 'flavour']),
    ],
  },
  {
    categorySlug: 'fresh',
    subcategorySlug: 'meat-fish',
    productTypes: [
      pt('Chicken', 'chicken', ['type', 'cut', 'weight', 'pack_size', 'fresh_frozen', 'pieces'], ['type', 'weight']),
      pt('Mutton', 'mutton', ['type', 'cut', 'weight', 'pack_size', 'fresh_frozen', 'pieces'], ['type', 'weight']),
      pt('Fish', 'fish', ['type', 'cut', 'weight', 'pack_size', 'fresh_frozen', 'pieces'], ['type', 'weight']),
      pt('Seafood', 'seafood', ['type', 'cut', 'weight', 'pack_size', 'fresh_frozen', 'pieces'], ['type', 'weight']),
      pt('Meat Products', 'meat-products', ['brand', 'type', 'weight', 'pack_size', 'fresh_frozen', 'veg_nonveg']),
    ],
  },
  {
    categorySlug: 'grocery',
    subcategorySlug: 'atta-rice',
    productTypes: [
      pt('Atta & Flour', 'atta-flour', ['brand', 'type', 'weight', 'pack_size', 'variety', 'organic', 'packaging_type']),
      pt('Rice', 'rice', ['brand', 'type', 'weight', 'pack_size', 'variety', 'organic', 'packaging_type']),
      pt('Edible Oil', 'edible-oil', ['brand', 'type', 'weight', 'pack_size', 'variety', 'organic', 'packaging_type']),
      pt('Dal & Pulses', 'dal-pulses', ['brand', 'type', 'weight', 'pack_size', 'variety', 'organic', 'packaging_type']),
    ],
  },
  {
    categorySlug: 'grocery',
    subcategorySlug: 'masala',
    productTypes: [
      pt('Whole Spices', 'whole-spices', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'organic']),
      pt('Powdered Spices', 'powdered-spices', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'organic']),
      pt('Masala Mixes', 'masala-mixes', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'organic']),
      pt('Dry Fruits', 'dry-fruits', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'organic']),
      pt('Nuts & Seeds', 'nuts-seeds', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'organic']),
    ],
  },
  {
    categorySlug: 'grocery',
    subcategorySlug: 'breakfast',
    productTypes: [
      pt('Breakfast Cereals', 'breakfast-cereals', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'dietary_type']),
      pt('Oats', 'oats', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'dietary_type']),
      pt('Spreads', 'spreads', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'dietary_type']),
      pt('Sauces', 'sauces', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'dietary_type']),
      pt('Jams', 'jams', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'dietary_type']),
      pt('Honey', 'honey', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'dietary_type']),
    ],
  },
  {
    categorySlug: 'grocery',
    subcategorySlug: 'packaged',
    productTypes: [
      pt('Noodles & Pasta', 'noodles-pasta', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'veg_nonveg', 'shelf_life']),
      pt('Canned Food', 'canned-food', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'veg_nonveg', 'shelf_life']),
      pt('Ready-to-Cook', 'ready-to-cook', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'veg_nonveg', 'shelf_life']),
      pt('Pickles', 'pickles', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'veg_nonveg', 'shelf_life']),
      pt('Papad', 'papad', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'veg_nonveg', 'shelf_life']),
      pt('Packaged Meals', 'packaged-meals', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'veg_nonveg', 'shelf_life']),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'tea-coffee',
    productTypes: [
      pt('Tea', 'tea', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'caffeine_type']),
      pt('Coffee', 'coffee', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'caffeine_type']),
      pt('Green Tea', 'green-tea', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'caffeine_type']),
      pt('Health Drinks', 'health-drinks', ['brand', 'type', 'weight', 'pack_size', 'flavour', 'dietary_type']),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'cold-drinks',
    productTypes: [
      pt('Soft Drinks', 'soft-drinks', ['brand', 'flavour', 'quantity', 'pack_size', 'type', 'sugar_type']),
      pt('Fruit Juices', 'fruit-juices', ['brand', 'flavour', 'quantity', 'pack_size', 'type', 'sugar_type']),
      pt('Energy Drinks', 'energy-drinks', ['brand', 'flavour', 'quantity', 'pack_size', 'type', 'sugar_type']),
      pt('Sports Drinks', 'sports-drinks', ['brand', 'flavour', 'quantity', 'pack_size', 'type', 'sugar_type']),
      pt('Water', 'water', ['brand', 'flavour', 'quantity', 'pack_size', 'type']),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'munchies',
    productTypes: [
      pt('Chips', 'chips', ['brand', 'flavour', 'weight', 'pack_size', 'spice_level']),
      pt('Namkeen', 'namkeen', ['brand', 'flavour', 'weight', 'pack_size', 'spice_level']),
      pt('Popcorn', 'popcorn', ['brand', 'flavour', 'weight', 'pack_size', 'spice_level']),
      pt('Nuts & Snacks', 'nuts-snacks', ['brand', 'flavour', 'weight', 'pack_size', 'spice_level']),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'biscuits',
    productTypes: [
      pt('Biscuits', 'biscuits', ['brand', 'flavour', 'weight', 'pack_size', 'dietary_type']),
      pt('Cookies', 'cookies', ['brand', 'flavour', 'weight', 'pack_size', 'dietary_type']),
      pt('Crackers', 'crackers', ['brand', 'flavour', 'weight', 'pack_size', 'dietary_type']),
      pt('Cream Biscuits', 'cream-biscuits', ['brand', 'flavour', 'weight', 'pack_size', 'dietary_type']),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'sweets',
    productTypes: [
      pt('Chocolates', 'chocolates', ['brand', 'flavour', 'weight', 'pack_size', 'type']),
      pt('Candies', 'candies', ['brand', 'flavour', 'weight', 'pack_size', 'type']),
      pt('Indian Sweets', 'indian-sweets', ['brand', 'flavour', 'weight', 'pack_size', 'type']),
      pt('Desserts', 'desserts', ['brand', 'flavour', 'weight', 'pack_size', 'type']),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'icecream',
    productTypes: [
      pt('Ice Cream', 'ice-cream', ['brand', 'flavour', 'quantity', 'pack_size', 'type']),
      pt('Ice Cream Cups', 'ice-cream-cups', ['brand', 'flavour', 'quantity', 'pack_size', 'type']),
      pt('Ice Cream Tubs', 'ice-cream-tubs', ['brand', 'flavour', 'quantity', 'pack_size', 'type']),
      pt('Frozen Desserts', 'frozen-desserts', ['brand', 'flavour', 'quantity', 'pack_size', 'type']),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'frozen',
    productTypes: [
      pt('Frozen Vegetables', 'frozen-vegetables', ['brand', 'type', 'weight', 'pack_size', 'veg_nonveg', 'storage_type']),
      pt('Frozen Snacks', 'frozen-snacks', ['brand', 'type', 'weight', 'pack_size', 'veg_nonveg', 'storage_type']),
      pt('Frozen Meals', 'frozen-meals', ['brand', 'type', 'weight', 'pack_size', 'veg_nonveg', 'storage_type']),
      pt('Frozen Meat', 'frozen-meat', ['brand', 'type', 'weight', 'pack_size', 'veg_nonveg', 'storage_type']),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'personal-care',
    productTypes: [
      pt('Deodorants', 'deodorants', ['brand', 'variant', 'quantity', 'pack_size', 'fragrance', 'gender']),
      pt('Body Care', 'body-care', ['brand', 'variant', 'quantity', 'pack_size', 'fragrance', 'gender']),
      pt('Oral Care', 'oral-care', ['brand', 'variant', 'quantity', 'pack_size', 'fragrance', 'type']),
      pt('Personal Hygiene', 'personal-hygiene', ['brand', 'variant', 'quantity', 'pack_size', 'type', 'gender']),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'skincare',
    productTypes: [
      pt('Face Wash', 'face-wash', ['brand', 'skin_type', 'quantity', 'pack_size', 'variant']),
      pt('Moisturizers', 'moisturizers', ['brand', 'skin_type', 'quantity', 'pack_size', 'spf', 'variant']),
      pt('Sunscreen', 'sunscreen', ['brand', 'skin_type', 'quantity', 'pack_size', 'spf', 'variant']),
      pt('Face Cream', 'face-cream', ['brand', 'skin_type', 'quantity', 'pack_size', 'spf', 'variant']),
      pt('Serums', 'serums', ['brand', 'skin_type', 'quantity', 'pack_size', 'variant']),
      pt('Face Masks', 'face-masks', ['brand', 'skin_type', 'quantity', 'pack_size', 'variant']),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'makeup',
    productTypes: [
      pt('Lipstick', 'lipstick', ['brand', 'shade', 'type', 'quantity', 'finish', 'skin_type']),
      pt('Foundation', 'foundation', ['brand', 'shade', 'type', 'quantity', 'finish', 'skin_type']),
      pt('Face Powder', 'face-powder', ['brand', 'shade', 'type', 'quantity', 'finish', 'skin_type']),
      pt('Kajal & Eyeliner', 'kajal-eyeliner', ['brand', 'shade', 'type', 'quantity', 'finish']),
      pt('Mascara', 'mascara', ['brand', 'shade', 'type', 'quantity', 'finish']),
      pt('Nail Care', 'nail-care', ['brand', 'shade', 'type', 'quantity', 'colour']),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'fragrance',
    productTypes: [
      pt('Perfume', 'perfume', ['brand', 'fragrance', 'quantity', 'pack_size', 'gender', 'type']),
      pt('Body Spray', 'body-spray', ['brand', 'fragrance', 'quantity', 'pack_size', 'gender', 'type']),
      pt('Fragrance Mist', 'fragrance-mist', ['brand', 'fragrance', 'quantity', 'pack_size', 'gender', 'type']),
      pt('Attar', 'attar', ['brand', 'fragrance', 'quantity', 'pack_size', 'gender', 'type']),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'bath-body',
    productTypes: [
      pt('Bath Soap', 'bath-soap', ['brand', 'variant', 'quantity', 'pack_size', 'fragrance', 'skin_type']),
      pt('Body Wash', 'body-wash', ['brand', 'variant', 'quantity', 'pack_size', 'fragrance', 'skin_type']),
      pt('Shampoo', 'shampoo-bath-body', ['brand', 'variant', 'quantity', 'pack_size', 'fragrance', 'hair_type']),
      pt('Hand Wash', 'hand-wash', ['brand', 'variant', 'quantity', 'pack_size', 'fragrance', 'skin_type']),
      pt('Body Lotion', 'body-lotion', ['brand', 'variant', 'quantity', 'pack_size', 'fragrance', 'skin_type']),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'haircare',
    productTypes: [
      pt('Shampoo', 'shampoo-haircare', ['brand', 'hair_type', 'quantity', 'pack_size', 'variant', 'fragrance']),
      pt('Conditioner', 'conditioner', ['brand', 'hair_type', 'quantity', 'pack_size', 'variant', 'fragrance']),
      pt('Hair Oil', 'hair-oil', ['brand', 'hair_type', 'quantity', 'pack_size', 'variant', 'fragrance']),
      pt('Hair Serum', 'hair-serum', ['brand', 'hair_type', 'quantity', 'pack_size', 'variant', 'fragrance']),
      pt('Hair Color', 'hair-color', ['brand', 'hair_type', 'quantity', 'pack_size', 'shade', 'variant']),
      pt('Hair Styling', 'hair-styling', ['brand', 'hair_type', 'quantity', 'pack_size', 'variant', 'fragrance']),
    ],
  },
  {
    categorySlug: 'health',
    subcategorySlug: 'protein',
    productTypes: [
      pt('Protein Powder', 'protein-powder', ['brand', 'flavour', 'weight', 'pack_size', 'type', 'serving_size']),
      pt('Protein Bars', 'protein-bars', ['brand', 'flavour', 'weight', 'pack_size', 'type', 'serving_size']),
      pt('Nutrition Drinks', 'nutrition-drinks', ['brand', 'flavour', 'weight', 'pack_size', 'type', 'serving_size']),
      pt('Supplements', 'supplements', ['brand', 'flavour', 'weight', 'pack_size', 'type', 'serving_size']),
    ],
  },
  {
    categorySlug: 'health',
    subcategorySlug: 'pharmacy',
    productTypes: [
      pt('Wellness Products', 'wellness-products', ['brand', 'type', 'quantity', 'pack_size', 'variant']),
      pt('First Aid', 'first-aid', ['brand', 'type', 'quantity', 'pack_size', 'variant']),
      pt('Health Care Products', 'health-care-products', ['brand', 'type', 'quantity', 'pack_size', 'variant']),
      pt('OTC Products', 'otc-products', ['brand', 'type', 'quantity', 'pack_size', 'variant']),
    ],
  },
  {
    categorySlug: 'health',
    subcategorySlug: 'feminine',
    productTypes: [
      pt('Sanitary Pads', 'sanitary-pads', ['brand', 'size', 'quantity', 'pack_size', 'absorbency', 'type']),
      pt('Tampons', 'tampons', ['brand', 'size', 'quantity', 'pack_size', 'absorbency', 'type']),
      pt('Panty Liners', 'panty-liners', ['brand', 'size', 'quantity', 'pack_size', 'absorbency', 'type']),
      pt('Intimate Care', 'intimate-care', ['brand', 'size', 'quantity', 'pack_size', 'type', 'fragrance']),
    ],
  },
  {
    categorySlug: 'baby',
    subcategorySlug: 'baby-care',
    productTypes: [
      pt('Diapers', 'diapers', ['brand', 'size', 'age_group', 'quantity', 'pack_size', 'variant']),
      pt('Baby Food', 'baby-food', ['brand', 'size', 'age_group', 'quantity', 'pack_size', 'flavour']),
      pt('Baby Wipes', 'baby-wipes', ['brand', 'size', 'age_group', 'quantity', 'pack_size', 'variant']),
      pt('Baby Bath & Body', 'baby-bath-body', ['brand', 'size', 'age_group', 'quantity', 'pack_size', 'variant']),
      pt('Baby Hair Care', 'baby-hair-care', ['brand', 'size', 'age_group', 'quantity', 'pack_size', 'variant']),
      pt('Feeding Products', 'feeding-products', ['brand', 'size', 'age_group', 'quantity', 'pack_size', 'material']),
    ],
  },
  {
    categorySlug: 'home',
    subcategorySlug: 'home-needs',
    productTypes: [
      pt('Storage & Organizers', 'storage-organizers', ['brand', 'material', 'size', 'colour', 'quantity', 'pack_size'], ['brand']),
      pt('Home Utility', 'home-utility', ['brand', 'material', 'size', 'colour', 'quantity', 'pack_size'], ['brand']),
      pt('Household Accessories', 'household-accessories', ['brand', 'material', 'size', 'colour', 'quantity', 'pack_size'], ['brand']),
    ],
  },
  {
    categorySlug: 'home',
    subcategorySlug: 'kitchenware',
    productTypes: [
      pt('Cookware', 'cookware', ['brand', 'material', 'size', 'capacity', 'colour']),
      pt('Kitchen Tools', 'kitchen-tools', ['brand', 'material', 'size', 'capacity', 'colour']),
      pt('Bottles & Containers', 'bottles-containers', ['brand', 'material', 'size', 'capacity', 'colour']),
      pt('Small Kitchen Appliances', 'small-kitchen-appliances', ['brand', 'material', 'size', 'capacity', 'power_wattage']),
    ],
  },
  {
    categorySlug: 'home',
    subcategorySlug: 'cleaning',
    productTypes: [
      pt('Floor Cleaners', 'floor-cleaners', ['brand', 'type', 'quantity', 'pack_size', 'fragrance', 'variant']),
      pt('Dishwashing', 'dishwashing', ['brand', 'type', 'quantity', 'pack_size', 'fragrance', 'variant']),
      pt('Toilet Cleaners', 'toilet-cleaners', ['brand', 'type', 'quantity', 'pack_size', 'fragrance', 'variant']),
      pt('Surface Cleaners', 'surface-cleaners', ['brand', 'type', 'quantity', 'pack_size', 'fragrance', 'variant']),
      pt('Laundry Products', 'laundry-products', ['brand', 'type', 'quantity', 'pack_size', 'fragrance', 'variant']),
      pt('Cleaning Tools', 'cleaning-tools', ['brand', 'type', 'quantity', 'pack_size', 'material']),
    ],
  },
  {
    categorySlug: 'home',
    subcategorySlug: 'electronics',
    productTypes: [
      pt('Chargers', 'chargers', ['brand', 'model', 'compatibility', 'colour', 'warranty', 'quantity']),
      pt('Cables', 'cables', ['brand', 'model', 'compatibility', 'colour', 'warranty', 'quantity']),
      pt('Batteries', 'batteries', ['brand', 'model', 'compatibility', 'quantity', 'pack_size']),
      pt('Earphones', 'earphones', ['brand', 'model', 'compatibility', 'colour', 'warranty']),
      pt('Mobile Accessories', 'mobile-accessories', ['brand', 'model', 'compatibility', 'colour', 'warranty']),
      pt('Small Electronic Accessories', 'small-electronic-accessories', ['brand', 'model', 'compatibility', 'colour', 'warranty']),
    ],
  },
  {
    categorySlug: 'home',
    subcategorySlug: 'paan',
    productTypes: [
      pt('Mouth Fresheners', 'mouth-fresheners', ['brand', 'type', 'flavour', 'quantity', 'pack_size']),
      pt('Paan Products', 'paan-products', ['brand', 'type', 'flavour', 'quantity', 'pack_size']),
      pt('Related Convenience Items', 'convenience-items', ['brand', 'type', 'flavour', 'quantity', 'pack_size']),
    ],
  },
  {
    categorySlug: 'fashion',
    subcategorySlug: 'apparel',
    productTypes: [
      pt('T-Shirts', 't-shirts', ['brand', 'size', 'colour', 'material', 'gender', 'age_group', 'pack_size']),
      pt('Shirts', 'shirts', ['brand', 'size', 'colour', 'material', 'gender', 'age_group', 'pack_size']),
      pt('Innerwear', 'innerwear', ['brand', 'size', 'colour', 'material', 'gender', 'age_group', 'pack_size']),
      pt('Socks', 'socks', ['brand', 'size', 'colour', 'material', 'gender', 'age_group', 'pack_size']),
      pt('Kids Wear', 'kids-wear', ['brand', 'size', 'colour', 'material', 'gender', 'age_group', 'pack_size']),
    ],
  },
  {
    categorySlug: 'fashion',
    subcategorySlug: 'jewellery',
    productTypes: [
      pt('Fashion Jewellery', 'fashion-jewellery', ['brand', 'material', 'colour', 'size', 'design', 'quantity']),
      pt('Earrings', 'earrings', ['brand', 'material', 'colour', 'size', 'design', 'quantity']),
      pt('Necklaces', 'necklaces', ['brand', 'material', 'colour', 'size', 'design', 'quantity']),
      pt('Bracelets', 'bracelets', ['brand', 'material', 'colour', 'size', 'design', 'quantity']),
      pt('Rings', 'rings', ['brand', 'material', 'colour', 'size', 'design', 'quantity']),
    ],
  },
  {
    categorySlug: 'pet',
    subcategorySlug: 'pet-care',
    productTypes: [
      pt('Pet Food', 'pet-food', ['brand', 'pet_type', 'age_group', 'flavour', 'weight', 'pack_size']),
      pt('Pet Treats', 'pet-treats', ['brand', 'pet_type', 'age_group', 'flavour', 'weight', 'pack_size']),
      pt('Pet Grooming', 'pet-grooming', ['brand', 'pet_type', 'age_group', 'type', 'quantity', 'material']),
      pt('Pet Hygiene', 'pet-hygiene', ['brand', 'pet_type', 'age_group', 'type', 'quantity', 'pack_size']),
      pt('Pet Accessories', 'pet-accessories', ['brand', 'pet_type', 'age_group', 'material', 'size', 'colour']),
    ],
  },
];

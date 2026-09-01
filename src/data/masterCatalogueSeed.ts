import { AttributeType } from '../types';

export type AttributeDef = {
  key: string;
  name: string;
  type: AttributeType;
  options?: string[];
};

/** Legacy attribute keys — kept in DB as inactive for backwards compatibility. */
export const DEPRECATED_ATTRIBUTE_KEYS = ['type', 'variant', 'quantity', 'weight'] as const;

/** Product types explicitly retired from the active catalogue. */
export const RETIRED_PRODUCT_TYPE_SLUGS = [
  'bath-body-shampoo-bath-body',
  'paan-mouth-fresheners',
  'paan-paan-products',
  'paan-convenience-items',
] as const;

const UNIT_OPTIONS = ['g', 'kg', 'ml', 'L', 'pcs', 'Pack'];
const SIZE_OPTIONS = ['Newborn', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free Size'];
const COLOUR_OPTIONS = ['Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Pink', 'Brown', 'Grey', 'Multicolour', 'Other'];
const MATERIAL_OPTIONS = ['Cotton', 'Polyester', 'Plastic', 'Steel', 'Glass', 'Wood', 'Silicone', 'Rubber', 'Leather', 'Metal', 'Other'];

/** Global reusable attributes */
export const ATTRIBUTE_DEFS: AttributeDef[] = [
  { key: 'brand', name: 'Brand', type: 'TEXT' },
  { key: 'net_quantity', name: 'Net Quantity', type: 'NUMBER' },
  { key: 'sold_as', name: 'Sold As', type: 'DROPDOWN', options: ['Pack', 'Loose', 'Piece'] },
  { key: 'unit', name: 'Unit', type: 'DROPDOWN', options: UNIT_OPTIONS },
  { key: 'variety', name: 'Variety', type: 'TEXT' },
  { key: 'organic', name: 'Organic', type: 'BOOLEAN' },
  { key: 'country_origin', name: 'Country of Origin', type: 'TEXT' },
  { key: 'pack_size', name: 'Pack Size', type: 'TEXT' },
  { key: 'fat_content', name: 'Fat Content', type: 'DROPDOWN', options: ['Full Cream', 'Toned', 'Double Toned', 'Skimmed'] },
  { key: 'flavour', name: 'Flavour', type: 'TEXT' },
  { key: 'dietary_type', name: 'Dietary Type', type: 'DROPDOWN', options: ['Vegetarian', 'Vegan', 'Gluten Free', 'Sugar Free'] },
  { key: 'milk_type', name: 'Milk Type', type: 'DROPDOWN', options: ['Cow', 'Buffalo', 'UHT', 'Flavored', 'Other'] },
  { key: 'rice_type', name: 'Rice Type', type: 'DROPDOWN', options: ['Basmati', 'Sona Masoori', 'Kolam', 'Brown', 'Red', 'Other'] },
  { key: 'oil_type', name: 'Oil Type', type: 'DROPDOWN', options: ['Mustard', 'Sunflower', 'Groundnut', 'Olive', 'Coconut', 'Rice Bran', 'Other'] },
  { key: 'atta_type', name: 'Atta Type', type: 'DROPDOWN', options: ['Whole Wheat', 'Multigrain', 'Refined', 'Other'] },
  { key: 'dal_type', name: 'Dal Type', type: 'DROPDOWN', options: ['Toor', 'Moong', 'Masoor', 'Chana', 'Urad', 'Mixed', 'Other'] },
  { key: 'meat_type', name: 'Meat Type', type: 'TEXT' },
  { key: 'bread_type', name: 'Bread Type', type: 'DROPDOWN', options: ['White', 'Brown', 'Multigrain', 'Milk', 'Whole Wheat', 'Other'] },
  { key: 'cheese_type', name: 'Cheese Type', type: 'DROPDOWN', options: ['Cheddar', 'Mozzarella', 'Processed', 'Parmesan', 'Cottage', 'Other'] },
  { key: 'egg_type', name: 'Egg Type', type: 'DROPDOWN', options: ['Brown', 'White', 'Free Range', 'Organic'] },
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
  { key: 'beverage_type', name: 'Beverage Type', type: 'DROPDOWN', options: ['Black Tea', 'Green Tea', 'Herbal Tea', 'Instant Coffee', 'Ground Coffee', 'Health Drink', 'Other'] },
  { key: 'drink_type', name: 'Drink Type', type: 'DROPDOWN', options: ['Carbonated', 'Juice', 'Energy', 'Sports', 'Packaged Water', 'Flavored Water'] },
  { key: 'sweet_type', name: 'Sweet Type', type: 'DROPDOWN', options: ['Chocolate', 'Candy', 'Mithai', 'Dessert', 'Other'] },
  { key: 'ice_cream_format', name: 'Ice Cream Format', type: 'DROPDOWN', options: ['Cup', 'Tub', 'Stick', 'Cone', 'Family Pack', 'Other'] },
  { key: 'frozen_product_type', name: 'Frozen Product Type', type: 'DROPDOWN', options: ['Vegetables', 'Snacks', 'Meals', 'Meat', 'Other'] },
  { key: 'cleaner_type', name: 'Cleaner Type', type: 'DROPDOWN', options: ['Floor', 'Toilet', 'Surface', 'Dishwash', 'Laundry', 'Other'] },
  { key: 'supplement_form', name: 'Supplement Form', type: 'DROPDOWN', options: ['Powder', 'Tablet', 'Capsule', 'Liquid', 'Bar', 'Other'] },
  { key: 'fragrance_format', name: 'Fragrance Format', type: 'DROPDOWN', options: ['EDP', 'EDT', 'Body Spray', 'Mist', 'Attar', 'Other'] },
  { key: 'oral_care_type', name: 'Oral Care Type', type: 'DROPDOWN', options: ['Toothpaste', 'Toothbrush', 'Mouthwash', 'Floss', 'Other'] },
  { key: 'fragrance', name: 'Fragrance', type: 'TEXT' },
  { key: 'gender', name: 'Gender', type: 'DROPDOWN', options: ['Men', 'Women', 'Unisex', 'Kids'] },
  { key: 'skin_type', name: 'Skin Type', type: 'DROPDOWN', options: ['Normal', 'Dry', 'Oily', 'Combination', 'Sensitive'] },
  { key: 'spf', name: 'SPF', type: 'NUMBER' },
  { key: 'shade', name: 'Shade', type: 'TEXT' },
  { key: 'finish', name: 'Finish', type: 'DROPDOWN', options: ['Matte', 'Glossy', 'Satin', 'Natural'] },
  { key: 'hair_type', name: 'Hair Type', type: 'DROPDOWN', options: ['Normal', 'Dry', 'Oily', 'Damaged', 'Curly', 'Straight'] },
  { key: 'serving_size', name: 'Serving Size', type: 'TEXT' },
  { key: 'size', name: 'Size', type: 'DROPDOWN', options: SIZE_OPTIONS },
  { key: 'absorbency', name: 'Absorbency', type: 'DROPDOWN', options: ['Light', 'Regular', 'Heavy', 'Overnight'] },
  { key: 'age_group', name: 'Age Group', type: 'DROPDOWN', options: ['0-6 months', '6-12 months', '1-2 years', '2-5 years', '5+ years'] },
  { key: 'material', name: 'Material', type: 'DROPDOWN', options: MATERIAL_OPTIONS },
  { key: 'colour', name: 'Colour', type: 'DROPDOWN', options: COLOUR_OPTIONS },
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

const B = 'brand';
const NQ = 'net_quantity';
const U = 'unit';
const PT = 'packaging_type';
const PS = 'pack_size';
const SL = 'shelf_life';
const ST = 'storage_type';
const FL = 'flavour';
const DT = 'dietary_type';
const OR = 'organic';
const VR = 'variety';
const SA = 'sold_as';
const CO = 'country_origin';
const FC = 'fat_content';
const VN = 'veg_nonveg';

const FRESH = [NQ, U, SA, VR, OR, CO];
const PACKAGED = [B, NQ, U, PT, PS];
const SNACK = [B, NQ, U, PT, PS, FL, DT];
const BEAUTY_PACK = [B, NQ, U, PT, PS, FL];
const SKIN = [B, 'skin_type', NQ, U, PT, FL];
const HAIR = [B, 'hair_type', NQ, U, PT, FL, 'gender'];

export const SUBCATEGORY_CATALOGUE: SubcategoryCatalogueSeed[] = [
  {
    categorySlug: 'fresh',
    subcategorySlug: 'fruits-veg',
    productTypes: [
      pt('Fresh Fruits', 'fresh-fruits', FRESH, [NQ, SA]),
      pt('Fresh Vegetables', 'fresh-vegetables', FRESH, [NQ, SA]),
      pt('Leafy Vegetables', 'leafy-vegetables', [NQ, U, SA, VR, OR], [NQ, SA]),
      pt('Herbs', 'herbs', [NQ, U, SA, VR, OR], [NQ, SA]),
    ],
  },
  {
    categorySlug: 'fresh',
    subcategorySlug: 'dairy',
    productTypes: [
      pt('Milk', 'milk', [B, 'milk_type', FC, NQ, U, PT, ST, SL]),
      pt('Curd & Yogurt', 'curd-yogurt', [B, FL, NQ, U, PT, ST, SL, DT]),
      pt('Butter', 'butter', [B, FC, NQ, U, PT, ST, SL, FL]),
      pt('Cheese', 'cheese', [B, 'cheese_type', FC, NQ, U, PT, ST, SL, FL]),
      pt('Paneer', 'paneer', [B, FC, NQ, U, PT, ST, SL]),
      pt('Cream', 'cream', [B, FC, NQ, U, PT, ST, SL, FL]),
    ],
  },
  {
    categorySlug: 'fresh',
    subcategorySlug: 'bread-eggs',
    productTypes: [
      pt('Bread', 'bread', [B, 'bread_type', NQ, U, PT, PS, FL, SL]),
      pt('Buns & Pav', 'buns-pav', [B, 'bread_type', NQ, U, PT, PS, FL, SL]),
      pt('Eggs', 'eggs', [B, 'egg_type', 'egg_size', NQ, U, PS, SA]),
      pt('Bakery Items', 'bakery-items', [B, 'bread_type', NQ, U, PT, PS, FL, SL]),
    ],
  },
  {
    categorySlug: 'fresh',
    subcategorySlug: 'meat-fish',
    productTypes: [
      pt('Chicken', 'chicken', ['meat_type', 'cut', NQ, U, PS, 'fresh_frozen', 'pieces'], ['meat_type', NQ]),
      pt('Mutton', 'mutton', ['meat_type', 'cut', NQ, U, PS, 'fresh_frozen', 'pieces'], ['meat_type', NQ]),
      pt('Fish', 'fish', ['meat_type', 'cut', NQ, U, PS, 'fresh_frozen', 'pieces'], ['meat_type', NQ]),
      pt('Seafood', 'seafood', ['meat_type', 'cut', NQ, U, PS, 'fresh_frozen', 'pieces'], ['meat_type', NQ]),
      pt('Meat Products', 'meat-products', [B, 'meat_type', NQ, U, PS, 'fresh_frozen', VN, SL]),
    ],
  },
  {
    categorySlug: 'grocery',
    subcategorySlug: 'atta-rice',
    productTypes: [
      pt('Atta & Flour', 'atta-flour', [B, 'atta_type', NQ, U, PT, PS, VR, OR, DT]),
      pt('Rice', 'rice', [B, 'rice_type', VR, NQ, U, PT, PS, OR, DT]),
      pt('Edible Oil', 'edible-oil', [B, 'oil_type', NQ, U, PT, PS, ST, OR]),
      pt('Dal & Pulses', 'dal-pulses', [B, 'dal_type', VR, NQ, U, PT, PS, OR, DT]),
    ],
  },
  {
    categorySlug: 'grocery',
    subcategorySlug: 'masala',
    productTypes: [
      pt('Whole Spices', 'whole-spices', [B, VR, NQ, U, PT, PS, FL, OR, 'spice_level']),
      pt('Powdered Spices', 'powdered-spices', [B, VR, NQ, U, PT, PS, FL, OR, 'spice_level']),
      pt('Masala Mixes', 'masala-mixes', [B, VR, NQ, U, PT, PS, FL, OR, 'spice_level']),
      pt('Dry Fruits', 'dry-fruits', [B, VR, NQ, U, PT, PS, OR, DT]),
      pt('Nuts & Seeds', 'nuts-seeds', [B, VR, NQ, U, PT, PS, OR, DT, FL]),
    ],
  },
  {
    categorySlug: 'grocery',
    subcategorySlug: 'breakfast',
    productTypes: [
      pt('Breakfast Cereals', 'breakfast-cereals', [B, NQ, U, PT, PS, FL, DT, SL]),
      pt('Oats', 'oats', [B, NQ, U, PT, PS, FL, DT, SL, OR]),
      pt('Spreads', 'spreads', [B, NQ, U, PT, PS, FL, DT, SL]),
      pt('Sauces', 'sauces', [B, NQ, U, PT, PS, FL, DT, SL, VN]),
      pt('Jams', 'jams', [B, NQ, U, PT, PS, FL, DT, SL]),
      pt('Honey', 'honey', [B, NQ, U, PT, PS, FL, OR, SL]),
    ],
  },
  {
    categorySlug: 'grocery',
    subcategorySlug: 'packaged',
    productTypes: [
      pt('Noodles & Pasta', 'noodles-pasta', [B, NQ, U, PT, PS, FL, VN, SL, DT]),
      pt('Canned Food', 'canned-food', [B, NQ, U, PT, PS, FL, VN, SL]),
      pt('Ready-to-Cook', 'ready-to-cook', [B, NQ, U, PT, PS, FL, VN, SL, 'spice_level']),
      pt('Pickles', 'pickles', [B, NQ, U, PT, PS, FL, VN, SL, 'spice_level']),
      pt('Papad', 'papad', [B, NQ, U, PT, PS, FL, VN, SL]),
      pt('Packaged Meals', 'packaged-meals', [B, NQ, U, PT, PS, FL, VN, SL, 'spice_level']),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'tea-coffee',
    productTypes: [
      pt('Tea', 'tea', [B, 'beverage_type', NQ, U, PT, PS, FL, 'caffeine_type']),
      pt('Coffee', 'coffee', [B, 'beverage_type', NQ, U, PT, PS, FL, 'caffeine_type']),
      pt('Green Tea', 'green-tea', [B, 'beverage_type', NQ, U, PT, PS, FL, 'caffeine_type']),
      pt('Health Drinks', 'health-drinks', [B, 'beverage_type', NQ, U, PT, PS, FL, DT]),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'cold-drinks',
    productTypes: [
      pt('Soft Drinks', 'soft-drinks', [B, 'drink_type', FL, NQ, U, PT, PS, 'sugar_type']),
      pt('Fruit Juices', 'fruit-juices', [B, 'drink_type', FL, NQ, U, PT, PS, 'sugar_type']),
      pt('Energy Drinks', 'energy-drinks', [B, 'drink_type', FL, NQ, U, PT, PS, 'sugar_type']),
      pt('Sports Drinks', 'sports-drinks', [B, 'drink_type', FL, NQ, U, PT, PS, 'sugar_type']),
      pt('Water', 'water', [B, 'drink_type', FL, NQ, U, PT, PS]),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'munchies',
    productTypes: [
      pt('Chips', 'chips', [B, FL, NQ, U, PT, PS, 'spice_level', DT]),
      pt('Namkeen', 'namkeen', [B, FL, NQ, U, PT, PS, 'spice_level', DT]),
      pt('Popcorn', 'popcorn', [B, FL, NQ, U, PT, PS, 'spice_level', DT]),
      pt('Nuts & Snacks', 'nuts-snacks', [B, FL, NQ, U, PT, PS, 'spice_level', DT, OR]),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'biscuits',
    productTypes: [
      pt('Biscuits', 'biscuits', SNACK),
      pt('Cookies', 'cookies', SNACK),
      pt('Crackers', 'crackers', SNACK),
      pt('Cream Biscuits', 'cream-biscuits', SNACK),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'sweets',
    productTypes: [
      pt('Chocolates', 'chocolates', [B, 'sweet_type', FL, NQ, U, PT, PS, DT]),
      pt('Candies', 'candies', [B, 'sweet_type', FL, NQ, U, PT, PS, DT]),
      pt('Indian Sweets', 'indian-sweets', [B, 'sweet_type', FL, NQ, U, PT, PS, DT]),
      pt('Desserts', 'desserts', [B, 'sweet_type', FL, NQ, U, PT, PS, DT, ST]),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'icecream',
    productTypes: [
      pt('Ice Cream', 'ice-cream', [B, 'ice_cream_format', FL, NQ, U, PT, PS, ST]),
      pt('Ice Cream Cups', 'ice-cream-cups', [B, 'ice_cream_format', FL, NQ, U, PT, PS, ST]),
      pt('Ice Cream Tubs', 'ice-cream-tubs', [B, 'ice_cream_format', FL, NQ, U, PT, PS, ST]),
      pt('Frozen Desserts', 'frozen-desserts', [B, 'ice_cream_format', FL, NQ, U, PT, PS, ST]),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'frozen',
    productTypes: [
      pt('Frozen Vegetables', 'frozen-vegetables', [B, 'frozen_product_type', NQ, U, PT, PS, VN, ST]),
      pt('Frozen Snacks', 'frozen-snacks', [B, 'frozen_product_type', NQ, U, PT, PS, VN, ST, FL]),
      pt('Frozen Meals', 'frozen-meals', [B, 'frozen_product_type', NQ, U, PT, PS, VN, ST, FL]),
      pt('Frozen Meat', 'frozen-meat', [B, 'frozen_product_type', 'meat_type', NQ, U, PT, PS, VN, ST]),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'personal-care',
    productTypes: [
      pt('Deodorants', 'deodorants', [B, NQ, U, PT, PS, 'fragrance', 'gender']),
      pt('Body Care', 'body-care', [B, NQ, U, PT, PS, 'fragrance', 'gender', 'skin_type']),
      pt('Oral Care', 'oral-care', [B, 'oral_care_type', NQ, U, PT, PS, FL]),
      pt('Personal Hygiene', 'personal-hygiene', [B, NQ, U, PT, PS, 'gender']),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'skincare',
    productTypes: [
      pt('Face Wash', 'face-wash', SKIN),
      pt('Moisturizers', 'moisturizers', [...SKIN, 'spf']),
      pt('Sunscreen', 'sunscreen', [...SKIN, 'spf'], [B, 'skin_type', 'spf', NQ]),
      pt('Face Cream', 'face-cream', [...SKIN, 'spf']),
      pt('Serums', 'serums', SKIN),
      pt('Face Masks', 'face-masks', SKIN),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'makeup',
    productTypes: [
      pt('Lipstick', 'lipstick', [B, 'shade', NQ, U, PT, 'finish', 'skin_type']),
      pt('Foundation', 'foundation', [B, 'shade', NQ, U, PT, 'finish', 'skin_type']),
      pt('Face Powder', 'face-powder', [B, 'shade', NQ, U, PT, 'finish', 'skin_type']),
      pt('Kajal & Eyeliner', 'kajal-eyeliner', [B, 'shade', NQ, U, PT, 'finish']),
      pt('Mascara', 'mascara', [B, 'shade', NQ, U, PT, 'finish']),
      pt('Nail Care', 'nail-care', [B, 'shade', 'colour', NQ, U, PT]),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'fragrance',
    productTypes: [
      pt('Perfume', 'perfume', [B, 'fragrance_format', 'fragrance', NQ, U, PT, PS, 'gender']),
      pt('Body Spray', 'body-spray', [B, 'fragrance_format', 'fragrance', NQ, U, PT, PS, 'gender']),
      pt('Fragrance Mist', 'fragrance-mist', [B, 'fragrance_format', 'fragrance', NQ, U, PT, PS, 'gender']),
      pt('Attar', 'attar', [B, 'fragrance_format', 'fragrance', NQ, U, PT, PS, 'gender']),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'bath-body',
    productTypes: [
      pt('Bath Soap', 'bath-soap', [B, NQ, U, PT, PS, 'fragrance', 'skin_type']),
      pt('Body Wash', 'body-wash', [B, NQ, U, PT, PS, 'fragrance', 'skin_type']),
      pt('Hand Wash', 'hand-wash', [B, NQ, U, PT, PS, 'fragrance', 'skin_type']),
      pt('Body Lotion', 'body-lotion', [B, NQ, U, PT, PS, 'fragrance', 'skin_type']),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'haircare',
    productTypes: [
      pt('Shampoo', 'shampoo-haircare', HAIR),
      pt('Conditioner', 'conditioner', HAIR),
      pt('Hair Oil', 'hair-oil', [B, 'hair_type', NQ, U, PT, FL, 'gender']),
      pt('Hair Serum', 'hair-serum', HAIR),
      pt('Hair Color', 'hair-color', [B, 'hair_type', 'shade', NQ, U, PT, 'gender']),
      pt('Hair Styling', 'hair-styling', HAIR),
    ],
  },
  {
    categorySlug: 'health',
    subcategorySlug: 'protein',
    productTypes: [
      pt('Protein Powder', 'protein-powder', [B, 'supplement_form', FL, NQ, U, PT, PS, 'serving_size']),
      pt('Protein Bars', 'protein-bars', [B, 'supplement_form', FL, NQ, U, PT, PS, 'serving_size', DT]),
      pt('Nutrition Drinks', 'nutrition-drinks', [B, 'supplement_form', FL, NQ, U, PT, PS, 'serving_size', DT]),
      pt('Supplements', 'supplements', [B, 'supplement_form', FL, NQ, U, PT, PS, 'serving_size']),
    ],
  },
  {
    categorySlug: 'health',
    subcategorySlug: 'pharmacy',
    productTypes: [
      pt('Wellness Products', 'wellness-products', [B, NQ, U, PT, PS, SL]),
      pt('First Aid', 'first-aid', [B, NQ, U, PT, PS, SL]),
      pt('Health Care Products', 'health-care-products', [B, NQ, U, PT, PS, SL]),
      pt('OTC Products', 'otc-products', [B, NQ, U, PT, PS, SL]),
    ],
  },
  {
    categorySlug: 'health',
    subcategorySlug: 'feminine',
    productTypes: [
      pt('Sanitary Pads', 'sanitary-pads', [B, 'size', PS, 'absorbency', 'pieces'], [B, 'size', PS]),
      pt('Tampons', 'tampons', [B, 'size', PS, 'absorbency', 'pieces'], [B, 'size', PS]),
      pt('Panty Liners', 'panty-liners', [B, 'size', PS, 'absorbency', 'pieces'], [B, 'size', PS]),
      pt('Intimate Care', 'intimate-care', [B, NQ, U, PT, PS, 'fragrance']),
    ],
  },
  {
    categorySlug: 'baby',
    subcategorySlug: 'baby-care',
    productTypes: [
      pt('Diapers', 'diapers', [B, 'age_group', 'size', 'absorbency', PS, 'pieces'], [B, 'age_group', 'size', PS]),
      pt('Baby Food', 'baby-food', [B, 'age_group', NQ, U, PT, PS, FL, DT]),
      pt('Baby Wipes', 'baby-wipes', [B, 'age_group', NQ, U, PT, PS, 'pieces']),
      pt('Baby Bath & Body', 'baby-bath-body', [B, 'age_group', NQ, U, PT, PS, FL]),
      pt('Baby Hair Care', 'baby-hair-care', [B, 'age_group', NQ, U, PT, PS, FL]),
      pt('Feeding Products', 'feeding-products', [B, 'age_group', 'material', NQ, U, PT, PS]),
    ],
  },
  {
    categorySlug: 'home',
    subcategorySlug: 'home-needs',
    productTypes: [
      pt('Storage & Organizers', 'storage-organizers', [B, 'material', 'size', 'colour', NQ, U, PT, PS], [B]),
      pt('Home Utility', 'home-utility', [B, 'material', 'size', 'colour', NQ, U, PT, PS], [B]),
      pt('Household Accessories', 'household-accessories', [B, 'material', 'size', 'colour', NQ, U, PT, PS], [B]),
    ],
  },
  {
    categorySlug: 'home',
    subcategorySlug: 'kitchenware',
    productTypes: [
      pt('Cookware', 'cookware', [B, 'material', 'size', 'capacity', 'colour']),
      pt('Kitchen Tools', 'kitchen-tools', [B, 'material', 'size', 'capacity', 'colour']),
      pt('Bottles & Containers', 'bottles-containers', [B, 'material', 'size', 'capacity', 'colour']),
      pt('Small Kitchen Appliances', 'small-kitchen-appliances', [B, 'material', 'capacity', 'power_wattage', 'warranty', 'model']),
    ],
  },
  {
    categorySlug: 'home',
    subcategorySlug: 'cleaning',
    productTypes: [
      pt('Floor Cleaners', 'floor-cleaners', [B, 'cleaner_type', NQ, U, PT, PS, FL, SL]),
      pt('Dishwashing', 'dishwashing', [B, 'cleaner_type', NQ, U, PT, PS, FL, SL]),
      pt('Toilet Cleaners', 'toilet-cleaners', [B, 'cleaner_type', NQ, U, PT, PS, FL, SL]),
      pt('Surface Cleaners', 'surface-cleaners', [B, 'cleaner_type', NQ, U, PT, PS, FL, SL]),
      pt('Laundry Products', 'laundry-products', [B, 'cleaner_type', NQ, U, PT, PS, FL, SL]),
      pt('Cleaning Tools', 'cleaning-tools', [B, 'material', 'size', 'colour']),
    ],
  },
  {
    categorySlug: 'fashion',
    subcategorySlug: 'electronics',
    productTypes: [
      pt('Chargers', 'chargers', [B, 'compatibility', 'power_wattage', 'model', PT, 'warranty']),
      pt('Cables', 'cables', [B, 'compatibility', 'model', 'colour', PT, 'warranty']),
      pt('Batteries', 'batteries', [B, 'compatibility', 'model', NQ, U, PT, PS]),
      pt('Earphones', 'earphones', [B, 'compatibility', 'model', 'colour', PT, 'warranty']),
      pt('Mobile Accessories', 'mobile-accessories', [B, 'compatibility', 'model', 'colour', PT, 'warranty']),
      pt('Small Electronic Accessories', 'small-electronic-accessories', [B, 'compatibility', 'model', 'colour', PT, 'warranty']),
    ],
  },
  {
    categorySlug: 'fashion',
    subcategorySlug: 'apparel',
    productTypes: [
      pt('T-Shirts', 't-shirts', [B, 'size', 'colour', 'material', 'gender', 'age_group']),
      pt('Shirts', 'shirts', [B, 'size', 'colour', 'material', 'gender', 'age_group']),
      pt('Innerwear', 'innerwear', [B, 'size', 'colour', 'material', 'gender', 'age_group']),
      pt('Socks', 'socks', [B, 'size', 'colour', 'material', 'gender', 'age_group']),
      pt('Kids Wear', 'kids-wear', [B, 'size', 'colour', 'material', 'gender', 'age_group']),
    ],
  },
  {
    categorySlug: 'fashion',
    subcategorySlug: 'jewellery',
    productTypes: [
      pt('Fashion Jewellery', 'fashion-jewellery', [B, 'material', 'colour', 'size', 'design']),
      pt('Earrings', 'earrings', [B, 'material', 'colour', 'size', 'design']),
      pt('Necklaces', 'necklaces', [B, 'material', 'colour', 'size', 'design']),
      pt('Bracelets', 'bracelets', [B, 'material', 'colour', 'size', 'design']),
      pt('Rings', 'rings', [B, 'material', 'colour', 'size', 'design']),
    ],
  },
  {
    categorySlug: 'pet',
    subcategorySlug: 'pet-care',
    productTypes: [
      pt('Pet Food', 'pet-food', [B, 'pet_type', 'age_group', FL, NQ, U, DT, PT, PS]),
      pt('Pet Treats', 'pet-treats', [B, 'pet_type', 'age_group', FL, NQ, U, PT, PS, DT]),
      pt('Pet Grooming', 'pet-grooming', [B, 'pet_type', 'age_group', NQ, U, PT, 'material']),
      pt('Pet Hygiene', 'pet-hygiene', [B, 'pet_type', 'age_group', NQ, U, PT, PS]),
      pt('Pet Accessories', 'pet-accessories', [B, 'pet_type', 'age_group', 'material', 'size', 'colour']),
    ],
  },
];

/** All product type slugs defined in the active catalogue seed. */
export function collectActiveProductTypeSlugs(): string[] {
  return SUBCATEGORY_CATALOGUE.flatMap((entry) =>
    entry.productTypes.map((productType) => `${entry.subcategorySlug}-${productType.slug}`)
  );
}

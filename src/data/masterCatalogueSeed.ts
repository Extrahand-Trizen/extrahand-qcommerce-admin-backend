import { AttributeType } from '../types';

export type AttributeDef = {
  key: string;
  name: string;
  type: AttributeType;
  options?: string[];
};

/** Legacy / deprecated attribute keys — kept in DB as inactive for backwards compatibility. */
export const DEPRECATED_ATTRIBUTE_KEYS = [
  'type',
  'variant',
  'quantity',
  'weight',
  'brand',
  'ice_cream_format',
  'frozen_product_type',
  'cleaner_type',
] as const;

/** Product types explicitly retired from the active catalogue. */
export const RETIRED_PRODUCT_TYPE_SLUGS = [
  'bath-body-shampoo-bath-body',
  'paan-mouth-fresheners',
  'paan-paan-products',
  'paan-convenience-items',
  'tea-coffee-green-tea',
  'electronics-small-electronic-accessories',
] as const;

const UNIT_OPTIONS = [
  'g', 'kg', 'ml', 'L', 'pcs', 'Pack',
  'piece', 'dozen', 'packet', 'box', 'bottle', 'can', 'jar',
  'sachet', 'pouch', 'tray', 'bag', 'bunch', 'bundle',
  'roll', 'strip', 'set', 'combo', 'unit',
];
const SIZE_OPTIONS = ['Newborn', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free Size'];
const COLOUR_OPTIONS = ['Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Pink', 'Brown', 'Grey', 'Multicolour', 'Other'];
const MATERIAL_OPTIONS = ['Cotton', 'Polyester', 'Plastic', 'Steel', 'Glass', 'Wood', 'Silicone', 'Rubber', 'Leather', 'Metal', 'Other'];

/** Global reusable attributes (56 active). Brand is Basic Details only — not listed here. */
export const ATTRIBUTE_DEFS: AttributeDef[] = [
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

/** Build a product type seed from explicit required + optional attribute keys (no brand default). */
function pt(name: string, slug: string, required: string[], optional: string[] = []): ProductTypeSeed {
  const attributes = [...new Set([...required, ...optional])];
  const req = required.filter((k) => attributes.includes(k));
  return { name, slug, attributes, required: req.length ? req : undefined };
}

const NQ = 'net_quantity';
const U = 'unit';
const SA = 'sold_as';
const VR = 'variety';
const OR = 'organic';
const CO = 'country_origin';
const MT = 'milk_type';
const FC = 'fat_content';
const PT = 'packaging_type';
const ST = 'storage_type';
const SL = 'shelf_life';
const FL = 'flavour';
const DT = 'dietary_type';
const CT = 'cheese_type';
const BT = 'bread_type';
const PS = 'pack_size';
const ET = 'egg_type';
const ES = 'egg_size';
const MEAT = 'meat_type';
const CUT = 'cut';
const FF = 'fresh_frozen';
const PC = 'pieces';
const VN = 'veg_nonveg';
const AT = 'atta_type';
const RT = 'rice_type';
const OT = 'oil_type';
const DL = 'dal_type';
const SP = 'spice_level';
const BV = 'beverage_type';
const CF = 'caffeine_type';
const DR = 'drink_type';
const SG = 'sugar_type';
const SW = 'sweet_type';
const SK = 'skin_type';
const SPF = 'spf';
const SH = 'shade';
const FN = 'finish';
const CL = 'colour';
const FFMT = 'fragrance_format';
const FR = 'fragrance';
const GN = 'gender';
const HT = 'hair_type';
const OC = 'oral_care_type';
const SF = 'supplement_form';
const SS = 'serving_size';
const SZ = 'size';
const AB = 'absorbency';
const AG = 'age_group';
const MA = 'material';
const CP = 'capacity';
const PW = 'power_wattage';
const MD = 'model';
const CY = 'compatibility';
const WR = 'warranty';
const DS = 'design';
const PET = 'pet_type';

export const SUBCATEGORY_CATALOGUE: SubcategoryCatalogueSeed[] = [
  {
    categorySlug: 'fresh',
    subcategorySlug: 'fruits-veg',
    productTypes: [
      pt('Fresh Fruits', 'fresh-fruits', [NQ, SA], [U, VR, OR, CO]),
      pt('Fresh Vegetables', 'fresh-vegetables', [NQ, SA], [U, VR, OR, CO]),
      pt('Leafy Vegetables', 'leafy-vegetables', [NQ, SA], [U, VR, OR]),
      pt('Herbs', 'herbs', [NQ, SA], [U, VR, OR]),
    ],
  },
  {
    categorySlug: 'fresh',
    subcategorySlug: 'dairy',
    productTypes: [
      pt('Milk', 'milk', [MT, NQ, U], [FC, PT, ST, SL]),
      pt('Curd & Yogurt', 'curd-yogurt', [NQ, U], [FL, PT, ST, SL, DT]),
      pt('Butter', 'butter', [NQ, U], [FC, PT, ST, SL, FL]),
      pt('Cheese', 'cheese', [CT, NQ, U], [FC, PT, ST, SL, FL]),
      pt('Paneer', 'paneer', [NQ, U], [FC, PT, ST, SL]),
      pt('Cream', 'cream', [NQ, U], [FC, PT, ST, SL, FL]),
    ],
  },
  {
    categorySlug: 'fresh',
    subcategorySlug: 'bread-eggs',
    productTypes: [
      pt('Bread', 'bread', [NQ, U], [BT, PT, PS, FL, SL]),
      pt('Buns & Pav', 'buns-pav', [NQ, U], [BT, PT, PS, FL, SL]),
      pt('Eggs', 'eggs', [ET, ES, NQ, U, SA], [PS]),
      pt('Bakery Items', 'bakery-items', [NQ, U], [BT, PT, PS, FL, SL]),
    ],
  },
  {
    categorySlug: 'fresh',
    subcategorySlug: 'meat-fish',
    productTypes: [
      pt('Chicken', 'chicken', [MEAT, NQ], [CUT, U, PS, FF, PC]),
      pt('Mutton', 'mutton', [MEAT, NQ], [CUT, U, PS, FF, PC]),
      pt('Fish', 'fish', [MEAT, NQ], [CUT, U, PS, FF, PC]),
      pt('Seafood', 'seafood', [MEAT, NQ], [CUT, U, PS, FF, PC]),
      pt('Meat Products', 'meat-products', [MEAT, NQ], [U, PS, FF, VN, SL]),
    ],
  },
  {
    categorySlug: 'grocery',
    subcategorySlug: 'atta-rice',
    productTypes: [
      pt('Atta & Flour', 'atta-flour', [AT, NQ, U], [PT, PS, VR, OR, DT]),
      pt('Rice', 'rice', [RT, NQ, U], [VR, PT, PS, OR, DT]),
      pt('Edible Oil', 'edible-oil', [OT, NQ, U], [PT, PS, ST, OR]),
      pt('Dal & Pulses', 'dal-pulses', [DL, NQ, U], [VR, PT, PS, OR, DT]),
    ],
  },
  {
    categorySlug: 'grocery',
    subcategorySlug: 'masala',
    productTypes: [
      pt('Whole Spices', 'whole-spices', [NQ, U], [VR, PT, PS, FL, OR, SP]),
      pt('Powdered Spices', 'powdered-spices', [NQ, U], [VR, PT, PS, FL, OR, SP]),
      pt('Masala Mixes', 'masala-mixes', [NQ, U], [VR, PT, PS, FL, OR, SP]),
      pt('Dry Fruits', 'dry-fruits', [NQ, U], [VR, PT, PS, OR, DT]),
      pt('Nuts & Seeds', 'nuts-seeds', [NQ, U], [VR, PT, PS, OR, DT, FL]),
    ],
  },
  {
    categorySlug: 'grocery',
    subcategorySlug: 'breakfast',
    productTypes: [
      pt('Breakfast Cereals', 'breakfast-cereals', [NQ, U], [PT, PS, FL, DT, SL]),
      pt('Oats', 'oats', [NQ, U], [PT, PS, FL, DT, SL, OR]),
      pt('Spreads', 'spreads', [NQ, U], [PT, PS, FL, DT, SL]),
      pt('Sauces', 'sauces', [NQ, U], [PT, PS, FL, DT, SL, VN]),
      pt('Jams', 'jams', [NQ, U], [PT, PS, FL, DT, SL]),
      pt('Honey', 'honey', [NQ, U], [PT, PS, FL, OR, SL]),
    ],
  },
  {
    categorySlug: 'grocery',
    subcategorySlug: 'packaged',
    productTypes: [
      pt('Noodles & Pasta', 'noodles-pasta', [NQ, U], [PT, PS, FL, VN, SL, DT]),
      pt('Canned Food', 'canned-food', [NQ, U], [PT, PS, FL, VN, SL]),
      pt('Ready-to-Cook', 'ready-to-cook', [NQ, U], [PT, PS, FL, VN, SL, SP]),
      pt('Pickles', 'pickles', [NQ, U], [PT, PS, FL, VN, SL, SP]),
      pt('Papad', 'papad', [NQ, U], [PT, PS, FL, VN, SL]),
      pt('Packaged Meals', 'packaged-meals', [NQ, U], [PT, PS, FL, VN, SL, SP]),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'tea-coffee',
    productTypes: [
      pt('Tea', 'tea', [NQ, U], [BV, PT, PS, FL, CF]),
      pt('Coffee', 'coffee', [NQ, U], [BV, PT, PS, FL, CF]),
      pt('Health Drinks', 'health-drinks', [NQ, U], [BV, PT, PS, FL, DT]),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'cold-drinks',
    productTypes: [
      pt('Soft Drinks', 'soft-drinks', [NQ, U], [DR, FL, PT, PS, SG]),
      pt('Fruit Juices', 'fruit-juices', [NQ, U], [DR, FL, PT, PS, SG]),
      pt('Energy Drinks', 'energy-drinks', [NQ, U], [DR, FL, PT, PS, SG]),
      pt('Sports Drinks', 'sports-drinks', [NQ, U], [DR, FL, PT, PS, SG]),
      pt('Water', 'water', [NQ, U], [DR, FL, PT, PS]),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'munchies',
    productTypes: [
      pt('Chips', 'chips', [NQ, U], [FL, PT, PS, SP, DT]),
      pt('Namkeen', 'namkeen', [NQ, U], [FL, PT, PS, SP, DT]),
      pt('Popcorn', 'popcorn', [NQ, U], [FL, PT, PS, SP, DT]),
      pt('Nuts & Snacks', 'nuts-snacks', [NQ, U], [FL, PT, PS, SP, DT, OR]),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'biscuits',
    productTypes: [
      pt('Biscuits', 'biscuits', [NQ, U], [PT, PS, FL, DT]),
      pt('Cookies', 'cookies', [NQ, U], [PT, PS, FL, DT]),
      pt('Crackers', 'crackers', [NQ, U], [PT, PS, FL, DT]),
      pt('Cream Biscuits', 'cream-biscuits', [NQ, U], [PT, PS, FL, DT]),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'sweets',
    productTypes: [
      pt('Chocolates', 'chocolates', [NQ, U], [SW, FL, PT, PS, DT]),
      pt('Candies', 'candies', [NQ, U], [SW, FL, PT, PS, DT]),
      pt('Indian Sweets', 'indian-sweets', [NQ, U], [SW, FL, PT, PS, DT]),
      pt('Desserts', 'desserts', [NQ, U], [SW, FL, PT, PS, DT, ST]),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'icecream',
    productTypes: [
      pt('Ice Cream', 'ice-cream', [NQ, U], [FL, PT, PS, ST]),
      pt('Ice Cream Cups', 'ice-cream-cups', [NQ, U], [FL, PT, PS, ST]),
      pt('Ice Cream Tubs', 'ice-cream-tubs', [NQ, U], [FL, PT, PS, ST]),
      pt('Frozen Desserts', 'frozen-desserts', [NQ, U], [FL, PT, PS, ST]),
    ],
  },
  {
    categorySlug: 'snacks',
    subcategorySlug: 'frozen',
    productTypes: [
      pt('Frozen Vegetables', 'frozen-vegetables', [NQ, U], [PT, PS, VN, ST]),
      pt('Frozen Snacks', 'frozen-snacks', [NQ, U], [PT, PS, VN, ST, FL]),
      pt('Frozen Meals', 'frozen-meals', [NQ, U], [PT, PS, VN, ST, FL]),
      pt('Frozen Meat', 'frozen-meat', [MEAT, NQ], [U, PT, PS, VN, ST]),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'personal-care',
    productTypes: [
      pt('Deodorants', 'deodorants', [NQ, U], [PT, PS, FR, GN]),
      pt('Body Care', 'body-care', [NQ, U], [PT, PS, FR, GN, SK]),
      pt('Oral Care', 'oral-care', [NQ, U], [OC, PT, PS, FL]),
      pt('Personal Hygiene', 'personal-hygiene', [NQ, U], [PT, PS, GN]),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'skincare',
    productTypes: [
      pt('Face Wash', 'face-wash', [SK, NQ, U], [PT, FL]),
      pt('Moisturizers', 'moisturizers', [SK, NQ, U], [PT, FL, SPF]),
      pt('Sunscreen', 'sunscreen', [SK, SPF, NQ, U], [PT, FL]),
      pt('Face Cream', 'face-cream', [SK, NQ, U], [PT, FL, SPF]),
      pt('Serums', 'serums', [SK, NQ, U], [PT, FL]),
      pt('Face Masks', 'face-masks', [SK, NQ, U], [PT, FL]),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'makeup',
    productTypes: [
      pt('Lipstick', 'lipstick', [SH, NQ, U], [PT, FN, SK]),
      pt('Foundation', 'foundation', [SH, NQ, U], [PT, FN, SK]),
      pt('Face Powder', 'face-powder', [SH, NQ, U], [PT, FN, SK]),
      pt('Kajal & Eyeliner', 'kajal-eyeliner', [SH, NQ, U], [PT, FN]),
      pt('Mascara', 'mascara', [NQ, U], [SH, PT, FN]),
      pt('Nail Care', 'nail-care', [NQ, U], [SH, CL, PT]),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'fragrance',
    productTypes: [
      pt('Perfume', 'perfume', [NQ, U], [FFMT, FR, PT, PS, GN]),
      pt('Body Spray', 'body-spray', [NQ, U], [FFMT, FR, PT, PS, GN]),
      pt('Fragrance Mist', 'fragrance-mist', [NQ, U], [FFMT, FR, PT, PS, GN]),
      pt('Attar', 'attar', [NQ, U], [FFMT, FR, PT, PS, GN]),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'bath-body',
    productTypes: [
      pt('Bath Soap', 'bath-soap', [NQ, U], [PT, PS, FR, SK]),
      pt('Body Wash', 'body-wash', [NQ, U], [PT, PS, FR, SK]),
      pt('Hand Wash', 'hand-wash', [NQ, U], [PT, PS, FR, SK]),
      pt('Body Lotion', 'body-lotion', [NQ, U], [PT, PS, FR, SK]),
    ],
  },
  {
    categorySlug: 'beauty',
    subcategorySlug: 'haircare',
    productTypes: [
      pt('Shampoo', 'shampoo-haircare', [HT, NQ, U], [PT, FL, GN]),
      pt('Conditioner', 'conditioner', [HT, NQ, U], [PT, FL, GN]),
      pt('Hair Oil', 'hair-oil', [HT, NQ, U], [PT, FL, GN]),
      pt('Hair Serum', 'hair-serum', [HT, NQ, U], [PT, FL, GN]),
      pt('Hair Color', 'hair-color', [SH, NQ, U], [HT, PT, GN]),
      pt('Hair Styling', 'hair-styling', [NQ, U], [HT, PT, FL, GN]),
    ],
  },
  {
    categorySlug: 'health',
    subcategorySlug: 'protein',
    productTypes: [
      pt('Protein Powder', 'protein-powder', [NQ, U], [SF, FL, PT, PS, SS]),
      pt('Protein Bars', 'protein-bars', [NQ, U], [SF, FL, PT, PS, SS, DT]),
      pt('Nutrition Drinks', 'nutrition-drinks', [NQ, U], [SF, FL, PT, PS, SS, DT]),
      pt('Supplements', 'supplements', [NQ, U], [SF, FL, PT, PS, SS]),
    ],
  },
  {
    categorySlug: 'health',
    subcategorySlug: 'pharmacy',
    productTypes: [
      pt('Wellness Products', 'wellness-products', [NQ, U], [PT, PS, SL]),
      pt('First Aid', 'first-aid', [NQ, U], [PT, PS, SL]),
      pt('Health Care Products', 'health-care-products', [NQ, U], [PT, PS, SL]),
      pt('OTC Products', 'otc-products', [NQ, U], [PT, PS, SL]),
    ],
  },
  {
    categorySlug: 'health',
    subcategorySlug: 'feminine',
    productTypes: [
      pt('Sanitary Pads', 'sanitary-pads', [SZ, PS], [AB, PC]),
      pt('Tampons', 'tampons', [SZ, PS], [AB, PC]),
      pt('Panty Liners', 'panty-liners', [SZ, PS], [AB, PC]),
      pt('Intimate Care', 'intimate-care', [NQ, U], [PT, PS, FR]),
    ],
  },
  {
    categorySlug: 'baby',
    subcategorySlug: 'baby-care',
    productTypes: [
      pt('Diapers', 'diapers', [AG, SZ, PS], [AB, PC]),
      pt('Baby Food', 'baby-food', [AG, NQ, U], [PT, PS, FL, DT]),
      pt('Baby Wipes', 'baby-wipes', [AG, NQ, U], [PT, PS, PC]),
      pt('Baby Bath & Body', 'baby-bath-body', [AG, NQ, U], [PT, PS, FL]),
      pt('Baby Hair Care', 'baby-hair-care', [AG, NQ, U], [PT, PS, FL]),
      pt('Feeding Products', 'feeding-products', [AG, MA, NQ, U], [PT, PS]),
    ],
  },
  {
    categorySlug: 'home',
    subcategorySlug: 'home-needs',
    productTypes: [
      pt('Storage & Organizers', 'storage-organizers', [MA], [SZ, CL, NQ, U, PT, PS]),
      pt('Home Utility', 'home-utility', [MA], [SZ, CL, NQ, U, PT, PS]),
      pt('Household Accessories', 'household-accessories', [MA], [SZ, CL, NQ, U, PT, PS]),
    ],
  },
  {
    categorySlug: 'home',
    subcategorySlug: 'kitchenware',
    productTypes: [
      pt('Cookware', 'cookware', [MA], [SZ, CP, CL]),
      pt('Kitchen Tools', 'kitchen-tools', [MA], [SZ, CP, CL]),
      pt('Bottles & Containers', 'bottles-containers', [MA, CP], [SZ, CL]),
      pt('Small Kitchen Appliances', 'small-kitchen-appliances', [MA], [CP, PW, WR, MD]),
    ],
  },
  {
    categorySlug: 'home',
    subcategorySlug: 'cleaning',
    productTypes: [
      pt('Floor Cleaners', 'floor-cleaners', [NQ, U], [PT, PS, FL, SL]),
      pt('Dishwashing', 'dishwashing', [NQ, U], [PT, PS, FL, SL]),
      pt('Toilet Cleaners', 'toilet-cleaners', [NQ, U], [PT, PS, FL, SL]),
      pt('Surface Cleaners', 'surface-cleaners', [NQ, U], [PT, PS, FL, SL]),
      pt('Laundry Products', 'laundry-products', [NQ, U], [PT, PS, FL, SL]),
      pt('Cleaning Tools', 'cleaning-tools', [MA], [SZ, CL]),
    ],
  },
  {
    categorySlug: 'fashion',
    subcategorySlug: 'electronics',
    productTypes: [
      pt('Chargers', 'chargers', [CY, PW], [MD, PT, WR]),
      pt('Cables', 'cables', [CY], [MD, CL, PT, WR]),
      pt('Batteries', 'batteries', [CY], [MD, NQ, U, PT, PS]),
      pt('Earphones', 'earphones', [CY], [MD, CL, PT, WR]),
      pt('Mobile Accessories', 'mobile-accessories', [CY], [MD, CL, PT, WR]),
    ],
  },
  {
    categorySlug: 'fashion',
    subcategorySlug: 'apparel',
    productTypes: [
      pt('T-Shirts', 't-shirts', [SZ, CL, MA, GN], [AG]),
      pt('Shirts', 'shirts', [SZ, CL, MA, GN], [AG]),
      pt('Innerwear', 'innerwear', [SZ, CL, MA, GN], [AG]),
      pt('Socks', 'socks', [SZ, CL, MA, GN], [AG]),
      pt('Kids Wear', 'kids-wear', [SZ, CL, MA, GN], [AG]),
    ],
  },
  {
    categorySlug: 'fashion',
    subcategorySlug: 'jewellery',
    productTypes: [
      pt('Fashion Jewellery', 'fashion-jewellery', [MA, CL, SZ], [DS]),
      pt('Earrings', 'earrings', [MA, CL, SZ], [DS]),
      pt('Necklaces', 'necklaces', [MA, CL, SZ], [DS]),
      pt('Bracelets', 'bracelets', [MA, CL, SZ], [DS]),
      pt('Rings', 'rings', [MA, CL, SZ], [DS]),
    ],
  },
  {
    categorySlug: 'pet',
    subcategorySlug: 'pet-care',
    productTypes: [
      pt('Pet Food', 'pet-food', [PET, NQ, U], [AG, FL, DT, PT, PS]),
      pt('Pet Treats', 'pet-treats', [PET, NQ, U], [AG, FL, DT, PT, PS]),
      pt('Pet Grooming', 'pet-grooming', [PET, NQ, U], [AG, PT, MA]),
      pt('Pet Hygiene', 'pet-hygiene', [PET, NQ, U], [AG, PT, PS]),
      pt('Pet Accessories', 'pet-accessories', [PET, MA], [AG, SZ, CL]),
    ],
  },
];

/** All product type slugs defined in the active catalogue seed. */
export function collectActiveProductTypeSlugs(): string[] {
  return SUBCATEGORY_CATALOGUE.flatMap((entry) =>
    entry.productTypes.map((productType) => `${entry.subcategorySlug}-${productType.slug}`)
  );
}

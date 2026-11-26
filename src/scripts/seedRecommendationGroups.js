const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'extrahand';

const RecommendationGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    vertical: { type: String, required: true },
    mode: { type: String, default: 'CATEGORY_DYNAMIC' },
    sourceCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    sourceSubcategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory' },
    includedProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MasterProduct' }],
    excludedProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MasterProduct' }],
    badgeText: { type: String },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, default: 'ACTIVE' },
    matchingOnboardingSubcategories: [{ type: String }],
    createdBy: { type: String, default: 'system-seed' },
  },
  { timestamps: true }
);

const RecommendationGroup =
  mongoose.models.RecommendationGroup ||
  mongoose.model('RecommendationGroup', RecommendationGroupSchema);

const initialPacks = [
  {
    name: 'Snacks, Biscuits & Cold Drinks Pack',
    code: 'kirana-snacks-beverages',
    description:
      'Fast-moving chips, namkeen, biscuits, tea, and soft drinks every neighborhood shop stocks.',
    vertical: 'KIRANA',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6a91308c3e9711e9a0cd4372',
    badgeText: 'MOST POPULAR',
    displayOrder: 1,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: [
      'Chips & Crisps',
      'Biscuits & Cookies',
      'Cold Drinks & Juices',
      'Tea, Coffee & Health Drinks',
      'Chocolates & Candies',
      'Snacks & Namkeen',
    ],
  },
  {
    name: 'Fresh Fruits & Daily Vegetables Pack',
    code: 'kirana-fruits-vegetables',
    description:
      'High-velocity fresh onions, potatoes, tomatoes, bananas, and daily cooking herbs.',
    vertical: 'KIRANA',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6a91308b3e9711e9a0cd4367',
    badgeText: 'DAILY ESSENTIALS',
    displayOrder: 2,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: ['Fruits & Vegetables'],
  },
  {
    name: 'Atta, Rice, Oil & Spices (Staples Pack)',
    code: 'kirana-grocery-staples',
    description:
      'Foundational kitchen staples: cooking oils, flour, rice, turmeric, and everyday spices.',
    vertical: 'KIRANA',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6a91308b3e9711e9a0cd436c',
    badgeText: 'HIGH DEMAND',
    displayOrder: 3,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: [
      'Atta, Flour & Maida',
      'Rice & Rice Products',
      'Cooking Oil & Ghee',
      'Masalas & Spices',
      'Salt, Sugar & Jaggery',
      'Dals & Pulses',
    ],
  },
  {
    name: 'Daily Soaps, Shampoos & Grooming Pack',
    code: 'kirana-beauty-grooming',
    description:
      'High-margin FMCG personal care: soaps, shampoos, oral care, and skin creams.',
    vertical: 'KIRANA',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6a91308c3e9711e9a0cd437a',
    badgeText: 'HIGH MARGIN',
    displayOrder: 4,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: [
      'Soaps & Body Wash',
      'Hair Care (Shampoo & Oil)',
      'Oral Care (Toothpaste & Brush)',
      'Face Care & Lotions',
      'Deodorants & Perfumes',
      'Shaving & Grooming',
    ],
  },
  {
    name: 'Home & Kitchen Essentials Pack',
    code: 'kirana-home-kitchen',
    description:
      'Utensils, storage containers, kitchenware, and daily home living supplies.',
    vertical: 'KIRANA',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6a91308e3e9711e9a0cd4388',
    displayOrder: 5,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: [
      'Buckets, Mugs & Plasticware',
      'Kitchen Towels & Tissues',
      'Mops, Brushes & Scrubs',
    ],
  },
  {
    name: 'School, College & Office Stationery Pack',
    code: 'kirana-stationery-books',
    description:
      'Notebooks, ball pens, pencils, adhesives, and geometry supplies for students.',
    vertical: 'KIRANA',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6ab360a4b84de076314e5b6d',
    displayOrder: 6,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: [
      'Notebooks, Pens & Pencils',
      'Office & School Stationery',
      'Adhesives, Tapes & Scissors',
    ],
  },
  {
    name: 'Pooja, Agarbatti & Camphor Pack',
    code: 'kirana-pooja-spiritual',
    description:
      'Pure camphor, agarbatti, dhoop sticks, pooja oil, and cotton wicks.',
    vertical: 'KIRANA',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6ab4b691a65d73901bb659b0',
    displayOrder: 7,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: [
      'Pooja Oil, Ghee & Diya',
      'Agarbatti & Dhoop',
      'Camphor, Matchboxes & Cotton Wicks',
    ],
  },
  {
    name: 'Baby Diapers & Infant Care Pack',
    code: 'kirana-baby-care',
    description:
      'Baby wipes, infant grooming, bath essentials, and daily diapers.',
    vertical: 'KIRANA',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6a91308d3e9711e9a0cd4386',
    displayOrder: 8,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: [
      'Diapers & Wipes',
      'Baby Bath & Skin Care',
      'Baby Food & Formula',
    ],
  },
  {
    name: 'Health Supplements & Wellness Pack',
    code: 'kirana-health-wellness',
    description:
      'Glucose, pain balms, oral rehydration, and basic first-aid wellness items.',
    vertical: 'KIRANA',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6a91308d3e9711e9a0cd4382',
    displayOrder: 9,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: [
      'Health Supplements & Glucose',
      'Over-the-Counter (OTC) Medicines',
    ],
  },
  {
    name: 'Pet Food & Care Pack (Kirana)',
    code: 'kirana-pet-care',
    description:
      'Packaged dog and cat food packets, treats, and dry nutrition.',
    vertical: 'KIRANA',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6a91308f3e9711e9a0cd4392',
    displayOrder: 10,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: [],
  },
  {
    name: 'Mobile Accessories & Daily Basics',
    code: 'kirana-lifestyle-accessories',
    description:
      'Fast charging cables, earphones, and basic daily apparel.',
    vertical: 'KIRANA',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6a91308e3e9711e9a0cd438e',
    displayOrder: 11,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: [],
  },
  {
    name: 'OTC Pain Relief & Cough Syrups',
    code: 'medical-otc-essentials',
    description:
      'Over-the-counter pain relief tablets and cough syrups for registered pharmacies.',
    vertical: 'MEDICAL',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6ae9861f2d6686ef87107b2d',
    badgeText: 'OTC ONLY',
    displayOrder: 1,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: ['Over-the-Counter (OTC) Medicines'],
  },
  {
    name: 'Premium Dog Food Essentials',
    code: 'petcare-dog-food',
    description: 'Commercial dry dog food nutrition for pet stores.',
    vertical: 'PET_CARE',
    mode: 'CATEGORY_DYNAMIC',
    sourceCategoryId: '6b043c50507fddf96f612632',
    badgeText: 'STARTER',
    displayOrder: 1,
    status: 'ACTIVE',
    matchingOnboardingSubcategories: [],
  },
];

async function seed() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri, { dbName });
  console.log('Connected.');

  for (const pack of initialPacks) {
    const res = await RecommendationGroup.findOneAndUpdate(
      { code: pack.code },
      { $set: pack },
      { upsert: true, new: true }
    );
    console.log(`Upserted pack: ${pack.name} (${pack.code}) -> ID: ${res._id}`);
  }

  const count = await RecommendationGroup.countDocuments();
  console.log(`Total Recommendation Groups in DB now: ${count}`);

  await mongoose.disconnect();
  console.log('Done!');
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});

import { connectDatabase, disconnectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import MedicalTaxonomy from '../models/MedicalTaxonomy';
import MasterProduct from '../models/MasterProduct';
import taxonomyData from '../data/pharmacyTaxonomyData.json';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// 3-5 character unique code prefix generator for the 29 medical categories
const CATEGORY_CODES: Record<string, string> = {
  'Prescription Medicines': 'MED-RX',
  'OTC Medicines': 'MED-OTC',
  'Vitamins, Minerals & Supplements': 'MED-VIT',
  'Digestive Health': 'MED-DIG',
  'Skin Care & Dermatology': 'MED-SKN',
  'Eye Care': 'MED-EYE',
  'Ear, Nose & Throat': 'MED-ENT',
  'Respiratory Care': 'MED-RESP',
  'Women’s Health': 'MED-WMN',
  'Baby & Child Care': 'MED-BABY',
  'Mother & Maternity Care': 'MED-MOM',
  'First Aid & Wound Care': 'MED-FAID',
  'Medical Devices & Equipment': 'MED-DEV',
  'Diabetes Care': 'MED-DIAB',
  'Orthopaedics & Supports': 'MED-ORTH',
  'Mobility & Home Care': 'MED-MOBL',
  'Surgical & Clinical Supplies': 'MED-SURG',
  'Personal Hygiene': 'MED-HYGN',
  'Oral & Dental Care': 'MED-DENT',
  'Nutrition & Medical Foods': 'MED-NUTR',
  'Sexual Wellness & Family Planning': 'MED-SEXW',
  'Disinfectants & Pest Control': 'MED-DISN',
  'Diagnostics & Test Kits': 'MED-DIAG',
  'Pharmacy Consumables': 'MED-CONS',
  'Hair Care': 'MED-HAIR',
  'Homeopathic Products': 'MED-HOME',
  'Ayurvedic & Traditional Products': 'MED-AYUR',
  'Veterinary Products': 'MED-VET',
  'Other Pharmacy Products': 'MED-OTHR',
};

const CATEGORY_PRODUCT_TYPES_MAP: Record<string, string[]> = {
  "Prescription Medicines": ["Medicine", "Other"],
  "OTC Medicines": ["OTC medicine", "Medicine", "Other"],
  "Vitamins, Minerals & Supplements": ["Vitamin/Supplement", "Medical food/nutrition", "Other"],
  "Digestive Health": ["OTC medicine", "Medicine", "Vitamin/Supplement", "Other"],
  "Skin Care & Dermatology": ["Personal care", "OTC medicine", "Medicine", "Other"],
  "Eye Care": ["Medicine", "OTC medicine", "Medical consumable", "Other"],
  "Ear, Nose & Throat": ["Medicine", "OTC medicine", "Medical device", "Other"],
  "Respiratory Care": ["Medicine", "Medical device", "OTC medicine", "Other"],
  "Women's Health": ["Personal care", "Diagnostic kit", "Medicine", "OTC medicine", "Other"],
  "Women’s Health": ["Personal care", "Diagnostic kit", "Medicine", "OTC medicine", "Other"],
  "Baby & Child Care": ["Personal care", "Medical device", "Vitamin/Supplement", "Medicine", "Other"],
  "Mother & Maternity Care": ["Personal care", "Medical device", "Medical consumable", "Other"],
  "First Aid & Wound Care": ["Medical consumable", "Medical device", "OTC medicine", "Other"],
  "Medical Devices & Equipment": ["Medical device", "Other"],
  "Diabetes Care": ["Medical device", "Diagnostic kit", "Medicine", "Other"],
  "Orthopaedics & Supports": ["Medical device", "Medical consumable", "Other"],
  "Mobility & Home Care": ["Medical device", "Medical consumable", "Other"],
  "Surgical & Clinical Supplies": ["Medical consumable", "Medical device", "Other"],
  "Personal Hygiene": ["Personal care", "Medical consumable", "Other"],
  "Oral & Dental Care": ["Personal care", "Medicine", "OTC medicine", "Other"],
  "Nutrition & Medical Foods": ["Medical food/nutrition", "Vitamin/Supplement", "Other"],
  "Sexual Wellness & Family Planning": ["Personal care", "Diagnostic kit", "Medical consumable", "Other"],
  "Disinfectants & Pest Control": ["Medical consumable", "Personal care", "Other"],
  "Diagnostics & Test Kits": ["Diagnostic kit", "Medical device", "Other"],
  "Pharmacy Consumables": ["Medical consumable", "Medical device", "Other"],
  "Hair Care": ["Personal care", "Medicine", "OTC medicine", "Other"],
  "Homeopathic Products": ["Homeopathic product", "Medicine", "Other"],
  "Ayurvedic & Traditional Products": ["Ayurvedic/Traditional product", "Medicine", "Other"],
  "Veterinary Products": ["Veterinary product", "Other"],
  "Other Pharmacy Products": ["Other", "Medicine", "Medical device", "Personal care", "Vitamin/Supplement"],
};

function getProductTypesForCategory(catName: string): string[] {
  return (
    CATEGORY_PRODUCT_TYPES_MAP[catName] || [
      'Medicine',
      'OTC medicine',
      'Medical device',
      'Medical consumable',
      'Personal care',
      'Vitamin/Supplement',
      'Other',
    ]
  );
}

export async function seedCompleteMedicalCatalogue() {
  await connectDatabase();
  console.log('--- Starting Complete 29 Medical Categories Migration ---');

  // Step 1: Clean up old umbrella 'Pharmacy & Medicines' subcategories & product types
  const oldUmbrella = await Category.findOne({
    $or: [{ code: 'MED' }, { slug: 'pharmacy-medicines' }, { name: 'Pharmacy & Medicines' }],
  });

  if (oldUmbrella) {
    console.log(`Found old umbrella category: ${oldUmbrella.name} (${oldUmbrella._id}). Cleaning old nested items...`);
    // Remove old subcategories under old umbrella
    const oldSubs = await Subcategory.find({ categoryId: oldUmbrella._id });
    const oldSubIds = oldSubs.map((s) => s._id);
    await ProductType.deleteMany({ subcategoryId: { $in: oldSubIds } });
    await Subcategory.deleteMany({ categoryId: oldUmbrella._id });
    await Category.findByIdAndDelete(oldUmbrella._id);
    console.log(`✓ Cleaned old umbrella and its ${oldSubs.length} subcategories.`);
  }

  // Step 2: Seed each of the 29 Medical Categories as First-Class Categories
  let totalCategories = 0;
  let totalSubcategories = 0;
  let totalProductTypes = 0;

  for (let i = 0; i < taxonomyData.categories.length; i++) {
    const catItem = taxonomyData.categories[i];
    const catName = catItem.name;
    const catCode = CATEGORY_CODES[catName] || `MED-${(i + 1).toString().padStart(2, '0')}`;
    const catSlug = slugify(catName);

    // Upsert Category
    const categoryDoc = await Category.findOneAndUpdate(
      {
        $or: [{ code: catCode }, { slug: catSlug }, { name: catName }],
      },
      {
        $set: {
          name: catName,
          slug: catSlug,
          code: catCode,
          vertical: 'MEDICAL',
          status: 'ACTIVE',
          displayOrder: i + 1,
          description: `Medical category for ${catName}`,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    totalCategories += 1;

    const applicableProductTypes = getProductTypesForCategory(catName);

    // Step 3: Seed all Subcategories under this Category
    for (let j = 0; j < catItem.subcategories.length; j++) {
      const subName = catItem.subcategories[j];
      const subSlug = `${catSlug}-${slugify(subName)}`.slice(0, 100);

      const subcategoryDoc = await Subcategory.findOneAndUpdate(
        {
          categoryId: categoryDoc._id,
          $or: [{ name: subName }, { slug: subSlug }],
        },
        {
          $set: {
            categoryId: categoryDoc._id,
            name: subName,
            slug: subSlug,
            vertical: 'MEDICAL',
            status: 'ACTIVE',
            displayOrder: j + 1,
            description: `${subName} under ${catName}`,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      totalSubcategories += 1;

      // Step 4: Seed Product Types under each Subcategory
      for (let k = 0; k < applicableProductTypes.length; k++) {
        const ptName = applicableProductTypes[k];
        const ptSlug = `${subSlug}-${slugify(ptName)}`.slice(0, 100);

        await ProductType.findOneAndUpdate(
          {
            subcategoryId: subcategoryDoc._id,
            $or: [{ name: ptName }, { slug: ptSlug }],
          },
          {
            $set: {
              categoryId: categoryDoc._id,
              subcategoryId: subcategoryDoc._id,
              name: ptName,
              slug: ptSlug,
              vertical: 'MEDICAL',
              status: 'ACTIVE',
              displayOrder: k + 1,
              description: `${ptName} for ${subName}`,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        totalProductTypes += 1;
      }
    }
    console.log(`✓ [${i + 1}/29] Seeded category: "${catName}" with ${catItem.subcategories.length} subcategories`);
  }

  // Step 5: Update Master MedicalTaxonomy Document for Seller Portal
  const rawProductTypes = taxonomyData.dropdowns['Product type'] || [
    'Medicine',
    'OTC medicine',
    'Vitamin/Supplement',
    'Medical device',
    'Diagnostic kit',
    'Medical consumable',
    'Personal care',
    'Medical food/nutrition',
    'Ayurvedic/Traditional product',
    'Homeopathic product',
    'Veterinary product',
    'Other',
  ];

  await MedicalTaxonomy.findOneAndUpdate(
    { key: 'pharmacy_master_taxonomy' },
    {
      $set: {
        key: 'pharmacy_master_taxonomy',
        categories: taxonomyData.categories.map((c) => ({
          name: c.name,
          slug: slugify(c.name),
          subcategories: c.subcategories,
        })),
        productTypes: rawProductTypes,
        dropdowns: taxonomyData.dropdowns,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Step 6: Fix sample product to link to Prescription Medicines category
  const rxCategory = await Category.findOne({ name: 'Prescription Medicines' });
  if (rxCategory) {
    const painSub = await Subcategory.findOne({ categoryId: rxCategory._id, name: 'Pain & Inflammation' });
    const tabType = painSub ? await ProductType.findOne({ subcategoryId: painSub._id, name: 'Tablet' }) : null;

    await MasterProduct.updateMany(
      { vertical: 'MEDICAL' },
      {
        $set: {
          categoryId: rxCategory._id,
          subcategoryId: painSub?._id,
          productTypeId: tabType?._id,
          vertical: 'MEDICAL',
          isMedicalProduct: true,
        },
      }
    );
    console.log(`✓ Re-linked medical master products to "${rxCategory.name}"`);
  }

  console.log('\n======================================================');
  console.log(`🎉 SUCCESS: MIGRATED TO 29 FIRST-CLASS MEDICAL CATEGORIES!`);
  console.log(` - Top-level Categories:   ${totalCategories} (All tagged vertical = MEDICAL)`);
  console.log(` - Subcategories:          ${totalSubcategories} (Directly under their categories)`);
  console.log(` - Product Types:          ${totalProductTypes} (Dosage forms & equipment templates)`);
  console.log('======================================================\n');

  await disconnectDatabase();
}

if (require.main === module) {
  seedCompleteMedicalCatalogue()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

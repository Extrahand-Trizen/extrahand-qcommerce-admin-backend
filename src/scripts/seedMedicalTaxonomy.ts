import { connectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import MedicalTaxonomy from '../models/MedicalTaxonomy';
import taxonomyData from '../data/pharmacyTaxonomyData.json';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export async function seedMedicalTaxonomy() {
  await connectDatabase();
  console.log('--- Starting Medical Master Catalogue Taxonomy Seed ---');

  // 1. Ensure Pharmacy & Medicines Category exists
  const pharmacyCategory = await Category.findOneAndUpdate(
    {
      $or: [
        { slug: 'pharmacy-medicines' },
        { name: 'Pharmacy & Medicines' },
        { code: 'MED' },
      ],
    },
    {
      $set: {
        name: 'Pharmacy & Medicines',
        slug: 'pharmacy-medicines',
        code: 'MED',
        status: 'ACTIVE',
        description: 'Pharmaceuticals, medicines, medical devices, healthcare and clinical products',
        displayOrder: 19,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`✓ Master Category verified: "${pharmacyCategory.name}" (${pharmacyCategory._id})`);

  let subcategoryCount = 0;
  let productTypeCount = 0;

  // 2. Seed 29 Main Categories as Subcategories in MongoDB
  for (let i = 0; i < taxonomyData.categories.length; i++) {
    const cat = taxonomyData.categories[i];
    const catSlug = `pharmacy-${slugify(cat.name)}`;

    const subcatDoc = await Subcategory.findOneAndUpdate(
      {
        categoryId: pharmacyCategory._id,
        $or: [
          { name: cat.name },
          { slug: catSlug },
        ],
      },
      {
        $set: {
          categoryId: pharmacyCategory._id,
          name: cat.name,
          slug: catSlug,
          status: 'ACTIVE',
          displayOrder: i + 1,
          description: `Medical category: ${cat.name}`,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    subcategoryCount += 1;

    // 3. Seed the subcategories as ProductTypes under each Subcategory
    for (let j = 0; j < cat.subcategories.length; j++) {
      const ptName = cat.subcategories[j];
      const ptSlug = `pharmacy-${slugify(cat.name)}-${slugify(ptName)}`.slice(0, 100);

      await ProductType.findOneAndUpdate(
        {
          subcategoryId: subcatDoc._id,
          $or: [
            { name: ptName },
            { slug: ptSlug },
          ],
        },
        {
          $set: {
            categoryId: pharmacyCategory._id,
            subcategoryId: subcatDoc._id,
            name: ptName,
            slug: ptSlug,
            status: 'ACTIVE',
            displayOrder: j + 1,
            description: `${ptName} (${cat.name})`,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      productTypeCount += 1;
    }
  }

  // 4. Upsert complete MedicalTaxonomy master document
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

  console.log(`✓ Successfully seeded ${subcategoryCount} medical main categories (subcategories in catalogue)`);
  console.log(`✓ Successfully seeded ${productTypeCount} medical subcategories (product types in catalogue)`);
  console.log(`✓ Successfully seeded ${rawProductTypes.length} medical product type classifications`);
  console.log(`✓ Successfully saved complete MedicalTaxonomy document in Master Catalogue`);
  console.log('🎉 Medical Master Catalogue Seed Finished Successfully! 🎉');
}

// Execute if run directly via CLI
if (require.main === module) {
  seedMedicalTaxonomy()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

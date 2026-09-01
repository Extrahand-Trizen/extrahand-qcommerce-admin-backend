import { connectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import { INACTIVE_SUBCATEGORY_SLUGS, MOBILE_CATALOGUE } from '../data/mobileCatalogue';

async function seedCatalogue() {
  await connectDatabase();

  let categoryCount = 0;
  let subcategoryCount = 0;
  const activeSubcategorySlugs = new Set<string>();

  for (let i = 0; i < MOBILE_CATALOGUE.length; i++) {
    const group = MOBILE_CATALOGUE[i];

    const category = await Category.findOneAndUpdate(
      { slug: group.id },
      {
        name: group.title,
        slug: group.id,
        imageUrl: group.imageUrl,
        displayOrder: i + 1,
        status: 'ACTIVE',
        description: `Imported from mobile app — ${group.title}`,
      },
      { upsert: true, new: true }
    );
    categoryCount += 1;

    for (let j = 0; j < group.subcategories.length; j++) {
      const sub = group.subcategories[j];
      activeSubcategorySlugs.add(sub.id);

      await Subcategory.findOneAndUpdate(
        { slug: sub.id },
        {
          categoryId: category._id,
          name: sub.label,
          slug: sub.id,
          imageUrl: sub.imageUrl,
          displayOrder: j + 1,
          status: 'ACTIVE',
          description: `${sub.label} — ${group.title}`,
        },
        { upsert: true, new: true }
      );
      subcategoryCount += 1;
    }
  }

  for (const slug of INACTIVE_SUBCATEGORY_SLUGS) {
    await Subcategory.findOneAndUpdate({ slug }, { status: 'INACTIVE' });
  }

  console.log(`Catalogue seeded: ${categoryCount} categories, ${subcategoryCount} active subcategories`);
  console.log(`Inactive subcategories: ${INACTIVE_SUBCATEGORY_SLUGS.join(', ')}`);
  process.exit(0);
}

seedCatalogue().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { connectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import { MOBILE_CATALOGUE } from '../data/mobileCatalogue';

async function seedCatalogue() {
  await connectDatabase();

  let categoryCount = 0;
  let subcategoryCount = 0;

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

  console.log(`Catalogue seeded: ${categoryCount} categories, ${subcategoryCount} subcategories`);
  process.exit(0);
}

seedCatalogue().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { connectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';

const DIWALI_CATALOGUE = [
  {
    name: 'Diyas and Oil Lamps',
    slug: 'diyas-and-oil-lamps',
    productTypes: ['Clay Diya', 'Brass Diya', 'Ceramic Diya', 'Decorative Diya', 'Electric Diya', 'Floating Diya'],
  },
  {
    name: 'Decorative Lights and LED String Lights',
    slug: 'decorative-lights-and-led-string-lights',
    productTypes: ['LED String Lights', 'Rice Lights', 'Curtain Lights', 'Rope Lights', 'Net Lights', 'Solar Lights', 'Decorative Lamps'],
  },
  {
    name: 'Candles',
    slug: 'candles',
    productTypes: ['Tealight Candles', 'Pillar Candles', 'Scented Candles', 'Floating Candles', 'Decorative Candles', 'LED Candles', 'Candle Sets'],
  },
  {
    name: 'Rangoli Products and Rangoli Kits',
    slug: 'rangoli-products-and-rangoli-kits',
    productTypes: ['Rangoli Colour Kit', 'Rangoli Powder', 'Rangoli Stencils', 'Rangoli Stickers', 'Rangoli Tool Kit', 'Flower Rangoli Kit'],
  },
  {
    name: 'Torans and Home Decorations',
    slug: 'torans-and-home-decorations',
    productTypes: ['Door Toran', 'Wall Hanging', 'Bandhanwar', 'Decorative Door Hanging', 'Entrance Decor', 'Decorative String', 'Home Decoration Set'],
  },
  {
    name: 'Diwali Gift Hampers',
    slug: 'diwali-gift-hampers',
    productTypes: ['Dry Fruit Hamper', 'Sweets Hamper', 'Pooja Hamper', 'Decor Hamper', 'Food Hamper', 'Gift Box', 'Combo Hamper'],
  },
  {
    name: 'Pooja Products and Idols',
    slug: 'pooja-products-and-idols',
    productTypes: ['Lakshmi Ganesh Idol', 'Pooja Thali', 'Pooja Diya', 'Incense Holder', 'Kalash', 'Bell', 'Pooja Kit', 'Agarbatti', 'Dhoop', 'Camphor Holder', 'Pooja Chowki', 'Pooja Accessories Set'],
  },
] as const;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function seedSeasonalCatalogue() {
  await connectDatabase();

  let category = await Category.findOne({
    $or: [
      { slug: 'festive-seasonal' },
      { code: 'FEST' },
      { name: { $regex: /^festive\s*(and|&)\s*seasonal$/i } },
    ],
  });

  if (!category) {
    category = await Category.create({
      name: 'Festive & Seasonal',
      slug: 'festive-seasonal',
      code: 'FEST',
      vertical: 'SEASONAL',
      festival: 'Diwali',
      description: 'Festival and seasonal products',
      displayOrder: 1,
      status: 'ACTIVE',
    });
  } else {
    category.name = 'Festive & Seasonal';
    category.code = 'FEST';
    category.vertical = 'SEASONAL';
    category.festival = 'Diwali';
    category.description = 'Festival and seasonal products';
    category.displayOrder = 1;
    await category.save();
  }

  let subcategoryCount = 0;
  let productTypeCount = 0;

  for (let subcategoryIndex = 0; subcategoryIndex < DIWALI_CATALOGUE.length; subcategoryIndex += 1) {
    const definition = DIWALI_CATALOGUE[subcategoryIndex];
    const subcategory = await Subcategory.findOneAndUpdate(
      { categoryId: category._id, name: definition.name },
      {
        $set: {
          vertical: 'SEASONAL',
          description: `${definition.name} for Diwali`,
          displayOrder: subcategoryIndex + 1,
        },
        $setOnInsert: {
          categoryId: category._id,
          name: definition.name,
          slug: definition.slug,
          status: 'ACTIVE',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    subcategoryCount += 1;

    for (let productTypeIndex = 0; productTypeIndex < definition.productTypes.length; productTypeIndex += 1) {
      const name = definition.productTypes[productTypeIndex];
      await ProductType.findOneAndUpdate(
        { subcategoryId: subcategory._id, name },
        {
          $set: {
            categoryId: category._id,
            vertical: 'SEASONAL',
            displayOrder: productTypeIndex + 1,
          },
          $setOnInsert: {
            subcategoryId: subcategory._id,
            name,
            slug: `diwali-${definition.slug}-${slugify(name)}`,
            status: 'ACTIVE',
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      productTypeCount += 1;
    }

    await ProductType.updateOne(
      { subcategoryId: subcategory._id, name: `${definition.name} Item`, status: 'ACTIVE' },
      { status: 'INACTIVE' },
    );
  }

  console.log(
    `Seasonal catalogue ready: ${category.name} (${category.festival}), ${subcategoryCount} subcategories, ${productTypeCount} product types.`,
  );
  process.exit(0);
}

seedSeasonalCatalogue().catch((error) => {
  console.error('Failed to seed Seasonal catalogue:', error);
  process.exit(1);
});

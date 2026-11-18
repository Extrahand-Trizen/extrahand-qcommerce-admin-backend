import { connectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';

export const FOOD_TAXONOMY_CATEGORIES = [
  {
    name: 'Biryani & Rice',
    code: 'F_BIRY',
    subcategories: [
      'Chicken Biryani',
      'Mutton Biryani',
      'Veg Biryani',
      'Egg Biryani',
      'Pulao',
      'Fried Rice',
      'Rice Bowls',
      'Plain Rice',
      'Other Rice Dishes',
    ],
  },
  {
    name: 'South Indian',
    code: 'F_SIND',
    subcategories: [
      'Idli',
      'Dosa',
      'Uttapam',
      'Vada',
      'Upma',
      'Pongal',
      'Puri',
      'South Indian Meals',
      'Other South Indian Dishes',
    ],
  },
  {
    name: 'North Indian',
    code: 'F_NIND',
    subcategories: [
      'Roti & Chapati',
      'Naan & Kulcha',
      'Paratha',
      'Paneer Dishes',
      'Dal & Lentils',
      'North Indian Curries',
      'Thali & Meals',
      'Other North Indian Dishes',
    ],
  },
  {
    name: 'Chinese & Asian',
    code: 'F_CHIN',
    subcategories: [
      'Noodles',
      'Fried Rice',
      'Manchurian',
      'Momos',
      'Spring Rolls',
      'Chinese Starters',
      'Asian Curries',
      'Sushi',
      'Other Asian Dishes',
    ],
  },
  {
    name: 'Pizza',
    code: 'F_PIZZ',
    subcategories: [
      'Veg Pizza',
      'Non-Veg Pizza',
      'Cheese Pizza',
      'Margherita Pizza',
      'Paneer Pizza',
      'Chicken Pizza',
      'Pizza Slices',
      'Other Pizza',
    ],
  },
  {
    name: 'Burgers & Sandwiches',
    code: 'F_BURG',
    subcategories: [
      'Veg Burgers',
      'Chicken Burgers',
      'Paneer Burgers',
      'Sandwiches',
      'Grilled Sandwiches',
      'Submarine Sandwiches',
      'Wraps & Rolls',
      'Other Burgers & Sandwiches',
    ],
  },
  {
    name: 'Fast Food & Snacks',
    code: 'F_FAST',
    subcategories: [
      'French Fries',
      'Puffs',
      'Samosa',
      'Kachori',
      'Spring Rolls',
      'Momos',
      'Pav Bhaji',
      'Chaat',
      'Street Food',
      'Other Snacks',
    ],
  },
  {
    name: 'Starters & Sides',
    code: 'F_STAR',
    subcategories: [
      'Veg Starters',
      'Chicken Starters',
      'Mutton Starters',
      'Fish Starters',
      'Seafood Starters',
      'Paneer Starters',
      'Salads',
      'Soups',
      'Fries & Wedges',
      'Other Starters',
    ],
  },
  {
    name: 'Bakery & Cakes',
    code: 'F_BAKE',
    subcategories: [
      'Birthday Cakes',
      'Chocolate Cakes',
      'Pastries',
      'Cupcakes',
      'Brownies',
      'Cookies',
      'Biscuits',
      'Bread',
      'Buns',
      'Puffs',
      'Donuts',
      'Other Bakery Products',
    ],
  },
  {
    name: 'Sweets & Desserts',
    code: 'F_SWEE',
    subcategories: [
      'Indian Sweets',
      'Gulab Jamun',
      'Rasgulla',
      'Laddu',
      'Kaju Katli',
      'Halwa',
      'Ice Cream',
      'Kulfi',
      'Puddings',
      'Waffles',
      'Pancakes',
      'Other Desserts',
    ],
  },
  {
    name: 'Beverages & Drinks',
    code: 'F_BEV',
    subcategories: [
      'Tea',
      'Coffee',
      'Milkshakes',
      'Fresh Juices',
      'Soft Drinks',
      'Smoothies',
      'Lassi',
      'Buttermilk',
      'Energy Drinks',
      'Hot Beverages',
      'Other Beverages',
    ],
  },
  {
    name: 'Meat & Seafood',
    code: 'F_MEAT',
    subcategories: [
      'Chicken',
      'Mutton',
      'Fish',
      'Prawns',
      'Crab',
      'Other Seafood',
      'Eggs',
      'Fresh Meat',
      'Frozen Meat',
      'Other Meat Products',
    ],
  },
  {
    name: 'Dairy & Eggs',
    code: 'F_DAIR',
    subcategories: [
      'Milk',
      'Curd',
      'Paneer',
      'Butter',
      'Cheese',
      'Ghee',
      'Cream',
      'Buttermilk',
      'Eggs',
      'Other Dairy Products',
    ],
  },
  {
    name: 'Packaged & Ready-to-Eat Food',
    code: 'F_PACK',
    subcategories: [
      'Packaged Snacks',
      'Chips',
      'Namkeen',
      'Instant Noodles',
      'Ready-to-Eat Meals',
      'Breakfast Cereals',
      'Chocolates',
      'Packaged Sweets',
      'Sauces & Spreads',
      'Pickles',
      'Other Packaged Food',
    ],
  },
  {
    name: 'Combos & Meal Boxes',
    code: 'F_COMB',
    subcategories: [
      'Veg Combos',
      'Non-Veg Combos',
      'Biryani Combos',
      'Rice Combos',
      'Burger Combos',
      'Pizza Combos',
      'Family Meal Boxes',
      'Lunch Boxes',
      'Dinner Boxes',
      'Other Combos',
    ],
  },
];

function slugify(val: string): string {
  return val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function seedFoodCatalogue() {
  await connectDatabase();
  console.log('Connected to database. Starting Food Catalogue seeding...');

  let catCount = 0;
  let subCount = 0;

  for (let i = 0; i < FOOD_TAXONOMY_CATEGORIES.length; i++) {
    const item = FOOD_TAXONOMY_CATEGORIES[i];
    const catSlug = `food-${slugify(item.name)}`;

    const category = await Category.findOneAndUpdate(
      { $or: [{ name: item.name }, { code: item.code }, { slug: catSlug }] },
      {
        $set: {
          name: item.name,
          vertical: 'FOOD',
          code: item.code,
          slug: catSlug,
          displayOrder: i + 1,
          status: 'ACTIVE',
          description: `${item.name} food & restaurant catalogue items`,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    catCount++;

    for (let j = 0; j < item.subcategories.length; j++) {
      const subName = item.subcategories[j];
      const subSlug = `food-${slugify(item.name)}-${slugify(subName)}`;

      await Subcategory.findOneAndUpdate(
        { categoryId: category._id, name: subName },
        {
          $set: {
            vertical: 'FOOD',
            displayOrder: j + 1,
            status: 'ACTIVE',
            description: `${subName} under ${item.name}`,
          },
          $setOnInsert: {
            categoryId: category._id,
            name: subName,
            slug: subSlug,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      subCount++;
    }
  }

  console.log(`Food Catalogue seeded successfully: ${catCount} categories, ${subCount} subcategories.`);
  process.exit(0);
}

seedFoodCatalogue().catch((err) => {
  console.error('Failed to seed Food Catalogue:', err);
  process.exit(1);
});

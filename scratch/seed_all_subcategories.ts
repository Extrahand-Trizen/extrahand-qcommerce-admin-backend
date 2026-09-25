import mongoose, { Types } from 'mongoose';
import Category from '../src/models/Category';
import Subcategory from '../src/models/Subcategory';

const CATEGORIES_DATA: Array<{
  categoryName: string;
  categoryAliases?: string[];
  code?: string;
  displayOrder: number;
  subcategories: string[];
}> = [
  {
    categoryName: 'Grocery & Staples',
    displayOrder: 1,
    subcategories: [
      'Rice, Atta & Flours',
      'Dals, Pulses & Grains',
      'Poha, Dalia & Vermicelli',
      'Oil, Ghee & Vanaspati',
      'Masala & Spices',
      'Sugar, Salt & Jaggery',
      'Dry Fruits, Nuts & Seeds',
      'Pickles, Chutneys & Sauces',
      'Jams, Honey & Spreads',
      'Papad & Fryums',
      'Baking Essentials',
    ],
  },
  {
    categoryName: 'Fruits & Vegetables',
    displayOrder: 2,
    subcategories: [
      'Fresh Vegetables',
      'Leafy Vegetables',
      'Exotic Vegetables',
      'Fresh Fruits',
      'Exotic Fruits',
      'Organic Fruits & Vegetables',
      'Cut Fruits & Vegetables',
      'Sprouts & Salad',
      'Fresh Herbs',
      'Seasonal Fruits & Vegetables',
    ],
  },
  {
    categoryName: 'Dairy, Bread & Eggs',
    displayOrder: 3,
    subcategories: [
      'Milk',
      'Milk Drinks',
      'Curd & Yogurt',
      'Paneer & Tofu',
      'Cheese',
      'Butter & Cream',
      'Buttermilk & Lassi',
      'Bread & Buns',
      'Bakery Essentials',
      'Eggs',
    ],
  },
  {
    categoryName: 'Snacks & Munchies',
    displayOrder: 4,
    subcategories: [
      'Namkeen & Savouries',
      'Chips & Nachos',
      'Popcorn',
      'Biscuits & Cookies',
      'Chocolates & Candies',
      'Nuts & Healthy Snacks',
      'Indian Snacks',
      'Western Snacks',
      'Protein & Nutrition Snacks',
    ],
  },
  {
    categoryName: 'Breakfast & Cereals',
    displayOrder: 5,
    subcategories: [
      'Cereals',
      'Oats & Muesli',
      'Granola',
      'Poha & Dalia',
      'Instant Breakfast',
      'Pancake & Waffle Mix',
      'Kids Breakfast',
      'Health Breakfast',
    ],
  },
  {
    categoryName: 'Ready-to-Eat & Packaged Food',
    displayOrder: 6,
    subcategories: [
      'Ready-to-Eat Meals',
      'Ready-to-Cook Foods',
      'Instant Mixes',
      'Instant Noodles & Pasta',
      'Canned & Packaged Foods',
      'Soup & Soup Mixes',
      'Packaged Curries',
      'Frozen Ready-to-Cook',
    ],
  },
  {
    categoryName: 'Beverages',
    displayOrder: 7,
    subcategories: [
      'Tea',
      'Coffee',
      'Green & Herbal Tea',
      'Juices',
      'Sharbat & Squashes',
      'Soft Drinks & Sodas',
      'Energy Drinks',
      'Sports Drinks',
      'Health & Nutrition Drinks',
      'Coconut Water',
      'Packaged Water',
      'Mixers & Tonic Water',
    ],
  },
  {
    categoryName: 'Home Cleaning & Laundry',
    displayOrder: 8,
    subcategories: [
      'Laundry Detergents',
      'Fabric Care',
      'Dishwashing',
      'Floor Cleaners',
      'Surface Cleaners',
      'Toilet & Bathroom Cleaners',
      'Kitchen Cleaners',
      'Cleaning Tools',
      'Disinfectants',
      'Garbage Bags',
      'Pest & Mosquito Control',
      'Air Fresheners',
      'Tissues & Paper Products',
    ],
  },
  {
    categoryName: 'Personal Care',
    displayOrder: 9,
    subcategories: [
      'Bath & Body',
      'Hair Care',
      'Skin Care',
      'Oral Care',
      'Shaving & Grooming',
      'Deodorants & Fragrances',
      'Feminine Hygiene',
      'Personal Hygiene',
      'Hand & Foot Care',
      'Men\'s Personal Care',
    ],
  },
  {
    categoryName: 'Beauty & Cosmetics',
    displayOrder: 10,
    subcategories: [
      'Face Care',
      'Makeup',
      'Lip Care',
      'Eye Makeup',
      'Nail Care',
      'Hair Styling',
      'Hair Colour',
      'Premium Hair Care',
      'Perfumes & Body Mists',
      'Men\'s Grooming',
      'Beauty Tools & Accessories',
    ],
  },
  {
    categoryName: 'Baby Care',
    displayOrder: 11,
    subcategories: [
      'Diapers',
      'Baby Wipes',
      'Baby Food',
      'Baby Formula',
      'Baby Feeding',
      'Baby Bath & Body',
      'Baby Skin Care',
      'Baby Hair Care',
      'Baby Laundry & Cleaning',
      'Baby Clothing',
      'Baby Grooming',
      'Baby Safety & Accessories',
    ],
  },
  {
    categoryName: 'Pet Supplies',
    categoryAliases: ['Pet Care'],
    displayOrder: 12,
    subcategories: [
      'Dog Food',
      'Cat Food',
      'Bird Food',
      'Fish Food',
      'Pet Treats & Chews',
      'Pet Toys',
      'Pet Grooming',
      'Pet Hygiene',
      'Pet Feeding',
      'Pet Accessories',
      'Aquarium & Fish Supplies',
      'Pet Health & Wellness',
    ],
  },
  {
    categoryName: 'Health & Wellness',
    displayOrder: 13,
    subcategories: [
      'Vitamins & Minerals',
      'Nutrition & Supplements',
      'Protein & Sports Nutrition',
      'Immunity & Wellness',
      'Health Drinks',
      'First Aid',
      'Personal Wellness',
      'Medical Devices',
      'Elder Care',
      'Healthcare Accessories',
    ],
  },
  {
    categoryName: 'Pharmacy & Medicines',
    displayOrder: 14,
    subcategories: [
      'Prescription Medicines',
      'OTC Medicines',
      'Generic Medicines',
      'Pain & Fever Care',
      'Cold & Cough Care',
      'Allergy Care',
      'Digestive & Acidity Care',
      'Diabetes Care',
      'Dermatology & Skin Care',
      'Eye & Ear Care',
      'Women\'s Healthcare',
      'Men\'s Healthcare',
      'Baby Healthcare',
      'Orthopaedic Care',
      'Surgical & Medical Supplies',
    ],
  },
  {
    categoryName: 'Meat, Poultry & Seafood',
    displayOrder: 15,
    subcategories: [
      'Chicken',
      'Mutton & Goat',
      'Fish',
      'Prawns & Shrimp',
      'Crab & Shellfish',
      'Other Seafood',
      'Eggs',
      'Processed Meat',
      'Sausages & Cold Cuts',
      'Marinated Meat',
      'Ready-to-Cook Meat',
      'Frozen Meat & Seafood',
    ],
  },
  {
    categoryName: 'Bakery & Sweets',
    displayOrder: 16,
    subcategories: [
      'Bread & Buns',
      'Cakes',
      'Pastries',
      'Muffins & Cupcakes',
      'Cookies & Rusks',
      'Khari & Puffs',
      'Sandwiches & Savouries',
      'Indian Sweets',
      'Bengali Sweets',
      'Milk Sweets',
      'Dry Fruit Sweets',
      'Festival Sweets',
      'Birthday & Custom Cakes',
      'Gift Boxes',
    ],
  },
  {
    categoryName: 'Frozen Food & Ice Cream',
    displayOrder: 17,
    subcategories: [
      'Frozen Vegetables',
      'Frozen Snacks',
      'Frozen Indian Foods',
      'Frozen Meat & Seafood',
      'Frozen Ready-to-Cook',
      'Ice Cream Cups',
      'Ice Cream Tubs',
      'Ice Cream Sticks & Bars',
      'Cones',
      'Kulfi',
      'Frozen Desserts',
      'Premium Ice Cream',
    ],
  },
  {
    categoryName: 'Kitchenware & Cookware',
    displayOrder: 18,
    subcategories: [
      'Cookware',
      'Tawa, Kadai & Pans',
      'Pressure Cookers',
      'Kitchen Utensils',
      'Cutlery & Serveware',
      'Plates, Bowls & Cups',
      'Storage Containers',
      'Lunch Boxes',
      'Water Bottles',
      'Baking Tools',
      'Kitchen Organisers',
      'Kitchen Cleaning Tools',
      'Small Kitchen Appliances',
    ],
  },
  {
    categoryName: 'Home & Living',
    displayOrder: 19,
    subcategories: [
      'Bedsheets & Bed Linen',
      'Blankets & Comforters',
      'Pillows & Cushions',
      'Towels & Bath Linen',
      'Curtains',
      'Door Mats',
      'Carpets & Rugs',
      'Home Decor',
      'Wall Decor',
      'Lamps & Lighting',
      'Candles & Home Fragrance',
      'Artificial Plants',
      'Storage & Organisation',
      'Bathroom Accessories',
    ],
  },
  {
    categoryName: 'Electronics & Mobile Accessories',
    displayOrder: 20,
    subcategories: [
      'Mobile Accessories',
      'Chargers & Adapters',
      'USB & Data Cables',
      'Power Banks',
      'Earphones & Headphones',
      'Bluetooth Speakers',
      'Smart Watches & Bands',
      'Computer Accessories',
      'Storage Devices',
      'Batteries',
      'Basic Home Electronics',
      'Smart Home Accessories',
    ],
  },
  {
    categoryName: 'Stationery & Books',
    displayOrder: 21,
    subcategories: [
      'Notebooks & Registers',
      'Diaries & Journals',
      'Pens & Pencils',
      'Markers & Highlighters',
      'Erasers & Sharpeners',
      'Files & Folders',
      'School Supplies',
      'Art & Craft Supplies',
      'Office Supplies',
      'School & College Books',
      'Competitive Exam Books',
      'Reference Books',
      'Children\'s Books & Comics',
      'Fiction & Non-Fiction',
    ],
  },
  {
    categoryName: 'Toys & Games',
    displayOrder: 22,
    subcategories: [
      'Baby & Toddler Toys',
      'Educational Toys',
      'Learning & STEM Toys',
      'Building Blocks',
      'Puzzles',
      'Board Games',
      'Dolls & Doll Houses',
      'Action Figures',
      'Cars & Vehicles',
      'Remote Control Toys',
      'Ride-On Toys',
      'Soft Toys',
      'Outdoor Toys',
      'Sports Toys',
      'Party Toys',
    ],
  },
  {
    categoryName: 'Fashion & Accessories',
    categoryAliases: ['Fashion & Lifestyle'],
    displayOrder: 23,
    subcategories: [
      'Men\'s Clothing',
      'Women\'s Clothing',
      'Kids\' Clothing',
      'Ethnic Wear',
      'Western Wear',
      'Innerwear',
      'Nightwear',
      'Sportswear',
      'Socks & Hosiery',
      'Belts & Wallets',
      'Caps & Hats',
      'Scarves & Stoles',
      'Fashion Accessories',
    ],
  },
  {
    categoryName: 'Footwear',
    displayOrder: 24,
    subcategories: [
      'Men\'s Footwear',
      'Women\'s Footwear',
      'Kids\' Footwear',
      'Casual Shoes',
      'Formal Shoes',
      'Sports Shoes',
      'Running Shoes',
      'Sandals',
      'Slippers & Flip-Flops',
      'Heels & Flats',
      'School Shoes',
      'Ethnic Footwear',
      'Shoe Care & Accessories',
    ],
  },
  {
    categoryName: 'Sports & Fitness',
    displayOrder: 25,
    subcategories: [
      'Gym & Fitness Equipment',
      'Yoga & Meditation',
      'Cricket',
      'Football',
      'Badminton',
      'Basketball',
      'Other Sports Equipment',
      'Cycling',
      'Sports Accessories',
      'Fitness Accessories',
      'Sports Nutrition',
    ],
  },
  {
    categoryName: 'Automotive',
    displayOrder: 26,
    subcategories: [
      'Car Accessories',
      'Bike Accessories',
      'Car Cleaning & Care',
      'Bike Cleaning & Care',
      'Engine Oil & Lubricants',
      'Car Electronics',
      'Mobile Holders',
      'Helmets & Safety Gear',
      'Tyres & Tubes',
      'Batteries',
      'Emergency & Repair Accessories',
    ],
  },
  {
    categoryName: 'Flowers, Gifts & Celebration',
    displayOrder: 27,
    subcategories: [
      'Fresh Flowers',
      'Bouquets',
      'Flower Arrangements',
      'Indoor & Outdoor Plants',
      'Birthday Gifts',
      'Anniversary Gifts',
      'Wedding Gifts',
      'Baby Gifts',
      'Festival Gifts',
      'Gift Hampers',
      'Personalized Gifts',
      'Greeting Cards',
      'Gift Wrapping',
      'Party & Celebration Supplies',
    ],
  },
  {
    categoryName: 'Pooja & Religious',
    displayOrder: 28,
    subcategories: [
      'Pooja Samagri',
      'Incense Sticks & Dhoop',
      'Camphor',
      'Pooja Oils & Wicks',
      'Diyas & Lamps',
      'Idols & Religious Frames',
      'Religious Books',
      'Calendars',
      'Festival Pooja Items',
      'Religious Gifts',
    ],
  },
  {
    categoryName: 'Restaurant & Food',
    displayOrder: 29,
    subcategories: [
      'Breakfast',
      'South Indian',
      'North Indian',
      'Regional Indian',
      'Rice & Biryani',
      'Meals & Thalis',
      'Curries & Gravies',
      'Breads & Rotis',
      'Starters',
      'Snacks',
      'Fast Food',
      'Burgers & Sandwiches',
      'Pizza',
      'Pasta & Noodles',
      'Momos',
      'Salads',
      'Desserts',
      'Beverages',
      'Combos',
    ],
  },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/['"’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function getUniqueSlug(baseText: string, catCode: string, currentSubId?: Types.ObjectId): Promise<string> {
  const base = slugify(baseText);
  let candidate = base;
  let exists = await Subcategory.findOne({ slug: candidate, _id: { $ne: currentSubId } });
  if (!exists) return candidate;

  // Try with catCode
  candidate = `${base}-${slugify(catCode)}`;
  exists = await Subcategory.findOne({ slug: candidate, _id: { $ne: currentSubId } });
  if (!exists) return candidate;

  // Append sequential counter
  let i = 2;
  while (true) {
    candidate = `${base}-${slugify(catCode)}-${i}`;
    exists = await Subcategory.findOne({ slug: candidate, _id: { $ne: currentSubId } });
    if (!exists) return candidate;
    i++;
  }
}

async function main() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri, { dbName: 'extrahand' });
  console.log('Connected to MongoDB');

  let totalCategoriesProcessed = 0;
  let totalSubcategoriesCreated = 0;
  let totalSubcategoriesUpdated = 0;

  for (const catData of CATEGORIES_DATA) {
    // 1. Find category by name or alias
    const namesToSearch = [catData.categoryName, ...(catData.categoryAliases || [])];
    let category = await Category.findOne({
      name: { $in: namesToSearch.map(n => new RegExp(`^${n}$`, 'i')) },
    });

    if (!category) {
      console.warn(`Category "${catData.categoryName}" not found. Creating...`);
      const baseCode = (catData.code || catData.categoryName.replace(/[^a-zA-Z]/g, '').slice(0, 4)).toUpperCase();
      const catSlug = slugify(catData.categoryName);
      category = await Category.create({
        name: catData.categoryName,
        code: baseCode,
        slug: catSlug,
        displayOrder: catData.displayOrder,
        status: 'ACTIVE',
      });
    } else {
      // Update name if it was an alias (e.g., Pet Care -> Pet Supplies) and update displayOrder
      let shouldSave = false;
      if (category.name !== catData.categoryName) {
        console.log(`Renaming category "${category.name}" -> "${catData.categoryName}"`);
        category.name = catData.categoryName;
        shouldSave = true;
      }
      if (category.displayOrder !== catData.displayOrder) {
        category.displayOrder = catData.displayOrder;
        shouldSave = true;
      }
      if (category.status !== 'ACTIVE') {
        category.status = 'ACTIVE';
        shouldSave = true;
      }
      if (shouldSave) {
        await category.save();
      }
    }

    totalCategoriesProcessed++;
    console.log(`\nProcessing Category #${catData.displayOrder}: [${category.code}] ${category.name} (_id: ${category._id})`);

    // 2. Process subcategories
    for (const subName of catData.subcategories) {
      // Random displayOrder strictly below 20 (between 1 and 19)
      const randomOrder = Math.floor(Math.random() * 19) + 1;

      // Check if subcategory already exists for this category
      let existingSub = await Subcategory.findOne({
        categoryId: category._id,
        name: { $regex: new RegExp(`^${subName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      });

      if (existingSub) {
        existingSub.displayOrder = randomOrder;
        existingSub.status = 'ACTIVE';
        await existingSub.save();
        totalSubcategoriesUpdated++;
        console.log(`  [UPDATED] "${subName}" -> order: ${randomOrder}, slug: ${existingSub.slug}`);
      } else {
        const uniqueSlug = await getUniqueSlug(subName, category.code);
        const newSub = await Subcategory.create({
          categoryId: category._id,
          name: subName,
          slug: uniqueSlug,
          displayOrder: randomOrder,
          status: 'ACTIVE',
        });
        totalSubcategoriesCreated++;
        console.log(`  [CREATED] "${subName}" -> order: ${randomOrder}, slug: ${newSub.slug}`);
      }
    }
  }

  console.log('\n==========================================');
  console.log(`Done!`);
  console.log(`Categories Processed: ${totalCategoriesProcessed}`);
  console.log(`Subcategories Created: ${totalSubcategoriesCreated}`);
  console.log(`Subcategories Updated: ${totalSubcategoriesUpdated}`);
  console.log(`Total Target Subcategories: ${totalSubcategoriesCreated + totalSubcategoriesUpdated}`);
  console.log('==========================================');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error running seeding script:', err);
  process.exit(1);
});

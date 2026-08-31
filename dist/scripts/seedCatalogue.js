"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("../config/database");
const Category_1 = __importDefault(require("../models/Category"));
const Subcategory_1 = __importDefault(require("../models/Subcategory"));
const mobileCatalogue_1 = require("../data/mobileCatalogue");
async function seedCatalogue() {
    await (0, database_1.connectDatabase)();
    let categoryCount = 0;
    let subcategoryCount = 0;
    for (let i = 0; i < mobileCatalogue_1.MOBILE_CATALOGUE.length; i++) {
        const group = mobileCatalogue_1.MOBILE_CATALOGUE[i];
        const category = await Category_1.default.findOneAndUpdate({ slug: group.id }, {
            name: group.title,
            slug: group.id,
            imageUrl: group.imageUrl,
            displayOrder: i + 1,
            status: 'ACTIVE',
            description: `Imported from mobile app — ${group.title}`,
        }, { upsert: true, new: true });
        categoryCount += 1;
        for (let j = 0; j < group.subcategories.length; j++) {
            const sub = group.subcategories[j];
            await Subcategory_1.default.findOneAndUpdate({ slug: sub.id }, {
                categoryId: category._id,
                name: sub.label,
                slug: sub.id,
                imageUrl: sub.imageUrl,
                displayOrder: j + 1,
                status: 'ACTIVE',
                description: `${sub.label} — ${group.title}`,
            }, { upsert: true, new: true });
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

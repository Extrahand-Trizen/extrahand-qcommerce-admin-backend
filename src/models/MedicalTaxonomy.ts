import mongoose, { Schema, Document } from 'mongoose';

export interface IMedicalTaxonomyCategory {
  name: string;
  slug: string;
  subcategories: string[];
}

export interface IMedicalTaxonomy extends Document {
  key: string;
  categories: IMedicalTaxonomyCategory[];
  productTypes: string[];
  dropdowns: Record<string, string[]>;
  updatedAt: Date;
  createdAt: Date;
}

const MedicalTaxonomySchema = new Schema<IMedicalTaxonomy>(
  {
    key: { type: String, required: true, unique: true, default: 'pharmacy_master_taxonomy' },
    categories: [
      {
        name: { type: String, required: true },
        slug: { type: String, required: true },
        subcategories: [{ type: String }],
      },
    ],
    productTypes: [{ type: String }],
    dropdowns: { type: Map, of: [String], default: {} },
  },
  { timestamps: true }
);

export default mongoose.model<IMedicalTaxonomy>('MedicalTaxonomy', MedicalTaxonomySchema);

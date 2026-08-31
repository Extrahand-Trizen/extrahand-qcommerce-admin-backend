"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const types_1 = require("../types");
const ProductAttributeValueSchema = new mongoose_1.Schema({
    attributeId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Attribute', required: true },
    value: { type: mongoose_1.Schema.Types.Mixed, required: true },
}, { _id: false });
const MasterProductSchema = new mongoose_1.Schema({
    categoryId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    subcategoryId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Subcategory', required: true, index: true },
    productTypeId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'ProductType', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    brand: { type: String, trim: true },
    description: { type: String },
    sku: { type: String, required: true, unique: true, trim: true },
    gtin: { type: String, trim: true, sparse: true },
    attributes: [ProductAttributeValueSchema],
    complianceInfo: { type: String },
    status: { type: String, enum: types_1.ENTITY_STATUS, default: 'ACTIVE', index: true },
    createdBy: { type: String },
    updatedBy: { type: String },
}, { timestamps: true });
MasterProductSchema.index({ name: 'text', brand: 'text', sku: 'text' });
exports.default = mongoose_1.default.model('MasterProduct', MasterProductSchema);

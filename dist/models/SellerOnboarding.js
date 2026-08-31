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
const SellerOnboardingSchema = new mongoose_1.Schema({
    sellerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Seller', required: true, unique: true, index: true },
    fullName: { type: String, required: true, trim: true },
    mobileNumber: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    shopName: { type: String, required: true, trim: true },
    shopType: { type: String, required: true, trim: true },
    shopMobileNumber: { type: String },
    shopEmail: { type: String, lowercase: true, trim: true },
    shopDescription: { type: String },
    latitude: { type: Number },
    longitude: { type: Number },
    address: { type: String, required: true },
    area: { type: String },
    locality: { type: String },
    city: { type: String, required: true, index: true },
    district: { type: String },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    landmark: { type: String },
    businessType: { type: String },
    pan: { type: String },
    gstin: { type: String },
    fssaiNumber: { type: String },
    status: { type: String, enum: types_1.ONBOARDING_STATUS, default: 'DRAFT', index: true },
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: String },
    adminComment: { type: String },
}, { timestamps: true });
exports.default = mongoose_1.default.model('SellerOnboarding', SellerOnboardingSchema);

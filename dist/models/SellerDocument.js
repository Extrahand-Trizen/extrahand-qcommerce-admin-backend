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
const SellerDocumentSchema = new mongoose_1.Schema({
    sellerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    onboardingId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'SellerOnboarding', required: true, index: true },
    documentType: { type: String, enum: types_1.DOCUMENT_TYPES, required: true },
    documentNumber: { type: String },
    fileUrl: { type: String, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    verificationStatus: { type: String, enum: types_1.DOCUMENT_VERIFICATION_STATUS, default: 'PENDING' },
    rejectionReason: { type: String },
    uploadedAt: { type: Date, default: Date.now },
    verifiedAt: { type: Date },
    verifiedBy: { type: String },
}, { timestamps: false });
SellerDocumentSchema.index({ sellerId: 1, documentType: 1 });
exports.default = mongoose_1.default.model('SellerDocument', SellerDocumentSchema);

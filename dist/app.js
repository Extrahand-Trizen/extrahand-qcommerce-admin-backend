"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const env_1 = require("./config/env");
const logger_1 = __importDefault(require("./config/logger"));
const errorHandler_1 = require("./middleware/errorHandler");
const auth_1 = __importDefault(require("./routes/auth"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const catalogue_1 = __importDefault(require("./routes/catalogue"));
const products_1 = __importDefault(require("./routes/products"));
const productSubmissions_1 = __importDefault(require("./routes/productSubmissions"));
const sellers_1 = __importDefault(require("./routes/sellers"));
const sellerListings_1 = __importDefault(require("./routes/sellerListings"));
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: env_1.env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
}));
app.use((0, compression_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, morgan_1.default)('combined', { stream: { write: (msg) => logger_1.default.info(msg.trim()) } }));
app.use('/uploads', express_1.default.static(path_1.default.join(process.cwd(), 'uploads')));
app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', service: 'quick-commerce-service' });
});
app.use('/api/v1/auth', auth_1.default);
app.use('/api/v1/admin/dashboard', dashboard_1.default);
app.use('/api/v1', catalogue_1.default);
app.use('/api/v1', products_1.default);
app.use('/api/v1/product-submissions', productSubmissions_1.default);
app.use('/api/v1/sellers', sellers_1.default);
app.use('/api/v1/seller-listings', sellerListings_1.default);
app.use(errorHandler_1.errorHandler);
exports.default = app;

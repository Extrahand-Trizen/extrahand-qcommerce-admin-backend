import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import { env } from './config/env';
import { getAllowedCorsOrigins } from './config/cors';
import logger from './config/logger';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import catalogueRoutes from './routes/catalogue';
import productRoutes from './routes/products';
import submissionRoutes from './routes/productSubmissions';
import sellerRoutes from './routes/sellers';
import sellerListingRoutes from './routes/sellerListings';
import sellerCatalogueRoutes from './routes/sellerCatalogue';
import sellerStoreRoutes from './routes/sellerStore';
import sellerPromotionRoutes from './routes/sellerPromotions';
import storeRoutes from './routes/store';

const app = express();

const allowedOrigins = getAllowedCorsOrigins();

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin(origin, callback) {
    // Allow non-browser clients (no Origin header) and whitelisted admin/app origins.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    logger.warn('CORS blocked origin', { origin, allowedOrigins });
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', service: 'quick-commerce-service' });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin/dashboard', dashboardRoutes);
app.use('/api/v1', catalogueRoutes);
app.use('/api/v1', productRoutes);
app.use('/api/v1/product-submissions', submissionRoutes);
app.use('/api/v1/sellers', sellerRoutes);
app.use('/api/v1/seller-listings', sellerListingRoutes);
app.use('/api/v1/seller', sellerCatalogueRoutes);
app.use('/api/v1/seller', sellerStoreRoutes);
app.use('/api/v1/seller', sellerPromotionRoutes);
app.use('/api/v1', storeRoutes);

app.use(errorHandler);

export default app;

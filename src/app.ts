import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import { env } from './config/env';
import logger from './config/logger';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import catalogueRoutes from './routes/catalogue';
import productRoutes from './routes/products';
import submissionRoutes from './routes/productSubmissions';
import sellerRoutes from './routes/sellers';
import sellerListingRoutes from './routes/sellerListings';
import storeRoutes from './routes/store';

const app = express();

app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
  credentials: true,
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
app.use('/api/v1', storeRoutes);

app.use(errorHandler);

export default app;

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import * as archiverModule from 'archiver';
import mongoose from 'mongoose';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerStoreSettings from '../models/SellerStoreSettings';
import SellerListing from '../models/SellerListing';
import MasterProduct from '../models/MasterProduct';
import ProductSubmission from '../models/ProductSubmission';
import ShopInventory from '../models/ShopInventory';
import CustomerOrder, { ICustomerOrder } from '../models/CustomerOrder';
import SellerLedger, { ISellerLedger } from '../models/SellerLedger';
import SellerPayout, { ISellerPayout } from '../models/SellerPayout';
import Promotion, { IPromotion } from '../models/Promotion';
import PriceReviewLog from '../models/PriceReviewLog';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import logger from '../config/logger';
import { SellerInvoiceService } from './SellerInvoiceService';

export interface IExportJob {
  jobId: string;
  sellerId: string;
  status:
  | 'PREPARING_DATA'
  | 'GENERATING_EXCEL'
  | 'GENERATING_PDFS'
  | 'CREATING_ZIP'
  | 'READY_TO_DOWNLOAD'
  | 'FAILED';
  stepText: string;
  progressPercent: number;
  fileName?: string;
  fileSizeBytes?: number;
  fileSizeFormatted?: string;
  downloadToken?: string;
  downloadUrl?: string;
  filePath?: string;
  expiresAt?: Date;
  error?: string;
  createdAt: Date;
  summaryStats?: {
    productsCount: number;
    inventoryCount: number;
    ordersCount: number;
    orderItemsCount: number;
    ledgerCount: number;
    payoutsCount: number;
    couponsCount: number;
    invoicesCount: number;
  };
}

/** In-memory tracking for active and recent export jobs */
const activeJobs = new Map<string, IExportJob>();
const tokenToJobMap = new Map<string, IExportJob>();

// Ensure temp exports directory exists
const EXPORTS_DIR = path.resolve(process.cwd(), 'uploads', 'temp-exports');
try {
  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }
} catch (e: any) {
  logger.warn('Failed to create temp-exports dir:', e?.message);
}

/**
 * Universal archiver instantiator supporting both Archiver v8+ (ZipArchive class)
 * and legacy CommonJS callable exports.
 */
function createZipArchive(options: any = { zlib: { level: 9 } }): any {
  const mod: any = archiverModule;
  if (typeof mod.ZipArchive === 'function') {
    return new mod.ZipArchive(options);
  }
  if (typeof mod.default === 'function') {
    return mod.default('zip', options);
  }
  if (typeof mod === 'function') {
    return mod('zip', options);
  }
  try {
    const reqMod: any = require('archiver');
    if (typeof reqMod.ZipArchive === 'function') {
      return new reqMod.ZipArchive(options);
    }
    if (typeof reqMod === 'function') {
      return reqMod('zip', options);
    }
    if (typeof reqMod.default === 'function') {
      return reqMod.default('zip', options);
    }
  } catch {}
  throw new Error('Could not instantiate ZipArchive from archiver package');
}

/* ------------------------------------------------------------------ */
/*  Formatting & Sanitization Helpers                                 */
/* ------------------------------------------------------------------ */

function formatIST(date?: Date | string | null): string {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateIST(date?: Date | string | null): string {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatRupees(paise?: number | null): string {
  if (paise === null || paise === undefined || isNaN(paise)) return '0.00';
  return (paise / 100).toFixed(2);
}

function maskPhone(phone?: string | null): string {
  if (!phone) return '-';
  const clean = String(phone).replace(/\D/g, '');
  if (clean.length < 6) return '••••';
  return `${clean.slice(0, 2)}••••••${clean.slice(-2)}`;
}

function maskBankAccount(acc?: string | null): string {
  if (!acc) return '-';
  const clean = String(acc).trim();
  if (clean.length <= 4) return `•••• ${clean}`;
  return `•••• •••• •••• ${clean.slice(-4)}`;
}

function maskCustomerName(name?: string | null): string {
  if (!name || !name.trim()) return 'Customer';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    const f = parts[0];
    return f.length > 2 ? `${f[0]}••••${f.slice(-1)}` : 'Customer';
  }
  return parts.map((p) => (p.length > 1 ? `${p[0]}••••` : p)).join(' ');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function safeString(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/** Apply Excel table header styling */
function styleHeaderRow(row: ExcelJS.Row, bgColorHex = 'FFF3C7') {
  row.font = { bold: true, color: { argb: 'FF111827' }, size: 10, name: 'Calibri' };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: bgColorHex },
  };
  row.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  row.height = 24;
}

/** Auto-fit column widths based on cell text lengths */
function autoFitColumns(worksheet: ExcelJS.Worksheet, minWidth = 14, maxWidth = 45) {
  worksheet.columns.forEach((column) => {
    let maxLen = 0;
    if (column.eachCell) {
      column.eachCell({ includeEmpty: false }, (cell) => {
        const str = cell.value ? String(cell.value) : '';
        maxLen = Math.max(maxLen, str.length);
      });
    }
    column.width = Math.max(minWidth, Math.min(maxLen + 3, maxWidth));
  });
}

/* ------------------------------------------------------------------ */
/*  PDF Generation Helpers with PDFKit                                */
/* ------------------------------------------------------------------ */

function renderPdfToBuffer(buildFn: (doc: InstanceType<typeof PDFDocument>) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      buildFn(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export class SellerDataExportService {
  /**
   * Start business data export job for seller.
   */
  static async startExport(sellerId: string): Promise<IExportJob> {
    const cleanSellerId = String(sellerId).trim();

    // Check if an existing in-progress job or fresh completed job exists (within 10 minutes)
    const existing = activeJobs.get(cleanSellerId);
    if (existing) {
      const ageMs = Date.now() - existing.createdAt.getTime();
      if (
        existing.status !== 'FAILED' &&
        (existing.status !== 'READY_TO_DOWNLOAD' || (ageMs < 10 * 60 * 1000 && existing.filePath && fs.existsSync(existing.filePath)))
      ) {
        return existing;
      }
    }

    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const newJob: IExportJob = {
      jobId,
      sellerId: cleanSellerId,
      status: 'PREPARING_DATA',
      stepText: 'Preparing business records...',
      progressPercent: 5,
      createdAt: new Date(),
    };

    activeJobs.set(cleanSellerId, newJob);

    // Run async in background
    setImmediate(async () => {
      try {
        await SellerDataExportService.executeExportProcess(cleanSellerId, jobId);
      } catch (err: any) {
        logger.error('Seller business data export job failed:', { sellerId: cleanSellerId, error: err?.message });
        const job = activeJobs.get(cleanSellerId);
        if (job && job.jobId === jobId) {
          job.status = 'FAILED';
          job.stepText = 'Export failed';
          job.error = err?.message || 'Failed to generate seller business records export archive.';
        }
      }
    });

    return newJob;
  }

  /**
   * Query status of current export job.
   */
  static getStatus(sellerId: string): IExportJob | null {
    const cleanSellerId = String(sellerId).trim();
    return activeJobs.get(cleanSellerId) || null;
  }

  /**
   * Validate token and retrieve export file path.
   */
  static getFileByToken(token: string): { filePath: string; fileName: string } | null {
    const job = tokenToJobMap.get(token);
    if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
      return null;
    }
    if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return {
      filePath: job.filePath,
      fileName: job.fileName || 'ExtraHand_Seller_Export.zip',
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Core Background Export Execution                                  */
  /* ------------------------------------------------------------------ */

  private static async executeExportProcess(sellerId: string, jobId: string): Promise<void> {
    const job = activeJobs.get(sellerId);
    if (!job || job.jobId !== jobId) return;

    // 1. Fetch All Seller Records
    job.status = 'PREPARING_DATA';
    job.stepText = 'Collecting store details, catalog, orders and financial records...';
    job.progressPercent = 15;

    const sellerObjId = new mongoose.Types.ObjectId(sellerId);

    const [
      seller,
      onboarding,
      storeSettings,
      listings,
      submissions,
      inventory,
      orders,
      ledger,
      payouts,
      promotions,
      priceLogs,
    ] = await Promise.all([
      Seller.findById(sellerId).lean(),
      SellerOnboarding.findOne({ sellerId: sellerObjId }).lean(),
      SellerStoreSettings.findOne({ sellerId: sellerObjId }).lean(),
      SellerListing.find({ sellerId: sellerObjId }).populate('masterProductId').lean(),
      ProductSubmission.find({ sellerId: sellerObjId }).lean(),
      ShopInventory.find({ sellerId: sellerObjId }).populate('masterProductId').lean(),
      CustomerOrder.find({ sellerId: sellerObjId }).sort({ createdAt: -1 }).lean(),
      SellerLedger.find({ sellerId: sellerObjId }).sort({ createdAt: -1 }).lean(),
      SellerPayout.find({ sellerId: sellerObjId }).sort({ createdAt: -1 }).lean(),
      Promotion.find({ sellerId: sellerObjId }).sort({ createdAt: -1 }).lean(),
      PriceReviewLog.find({ sellerId: sellerObjId }).sort({ createdAt: -1 }).lean(),
    ]);

    if (!seller && !onboarding) {
      throw new Error('Seller store records not found.');
    }

    // Format Export Date string: YYYYMMDD_HHmmss
    const now = new Date();
    const dateStamp = now
      .toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '_')
      .slice(0, 15);
    const storeCode = String(sellerId).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
    const zipFileName = `ExtraHand_Seller_Export_${storeCode}_${dateStamp}.zip`;
    const zipFilePath = path.join(EXPORTS_DIR, zipFileName);

    // Setup Archiver ZIP stream
    const output = fs.createWriteStream(zipFilePath);
    const archive = createZipArchive({ zlib: { level: 9 } });

    const archiveClosedPromise = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
    });

    archive.pipe(output);

    // 2. Generate Excel Files
    job.status = 'GENERATING_EXCEL';
    job.stepText = 'Generating structured business spreadsheets...';
    job.progressPercent = 40;

    // A. 01_Store_Details/Store_Details.xlsx
    const wbStore = new ExcelJS.Workbook();
    SellerDataExportService.buildStoreDetailsSheet(wbStore, { seller, onboarding, storeSettings });
    const bufStore = await wbStore.xlsx.writeBuffer();
    archive.append(Buffer.from(bufStore), { name: '01_Store_Details/Store_Details.xlsx' });

    // B. 02_Product_Catalogue/Products.xlsx
    const wbProducts = new ExcelJS.Workbook();
    SellerDataExportService.buildProductsSheet(wbProducts, { listings, submissions });
    const bufProducts = await wbProducts.xlsx.writeBuffer();
    archive.append(Buffer.from(bufProducts), { name: '02_Product_Catalogue/Products.xlsx' });

    // C. 03_Inventory/Current_Inventory.xlsx & Stock_History.xlsx
    const wbCurInv = new ExcelJS.Workbook();
    SellerDataExportService.buildCurrentInventorySheet(wbCurInv, { inventory, listings });
    const bufCurInv = await wbCurInv.xlsx.writeBuffer();
    archive.append(Buffer.from(bufCurInv), { name: '03_Inventory/Current_Inventory.xlsx' });

    const wbStockHist = new ExcelJS.Workbook();
    SellerDataExportService.buildStockHistorySheet(wbStockHist, { inventory, listings, priceLogs, orders });
    const bufStockHist = await wbStockHist.xlsx.writeBuffer();
    archive.append(Buffer.from(bufStockHist), { name: '03_Inventory/Stock_History.xlsx' });

    // D. 04_Order_History/Complete_Orders.xlsx & Order_Items.xlsx
    const wbOrders = new ExcelJS.Workbook();
    SellerDataExportService.buildCompleteOrdersSheet(wbOrders, { orders, ledger });
    const bufOrders = await wbOrders.xlsx.writeBuffer();
    archive.append(Buffer.from(bufOrders), { name: '04_Order_History/Complete_Orders.xlsx' });

    const wbOrderItems = new ExcelJS.Workbook();
    SellerDataExportService.buildOrderItemsSheet(wbOrderItems, { orders });
    const bufOrderItems = await wbOrderItems.xlsx.writeBuffer();
    archive.append(Buffer.from(bufOrderItems), { name: '04_Order_History/Order_Items.xlsx' });

    // E. 05_Payments_and_Settlements/Payment_History.xlsx & Settlement_History.xlsx
    const wbPayments = new ExcelJS.Workbook();
    SellerDataExportService.buildPaymentHistorySheet(wbPayments, { ledger });
    const bufPayments = await wbPayments.xlsx.writeBuffer();
    archive.append(Buffer.from(bufPayments), { name: '05_Payments_and_Settlements/Payment_History.xlsx' });

    const wbSettlements = new ExcelJS.Workbook();
    SellerDataExportService.buildSettlementHistorySheet(wbSettlements, { payouts });
    const bufSettlements = await wbSettlements.xlsx.writeBuffer();
    archive.append(Buffer.from(bufSettlements), { name: '05_Payments_and_Settlements/Settlement_History.xlsx' });

    // F. 06_Platform_Fees/Platform_Fee_Details.xlsx
    const wbFees = new ExcelJS.Workbook();
    SellerDataExportService.buildPlatformFeeSheet(wbFees, { orders, ledger });
    const bufFees = await wbFees.xlsx.writeBuffer();
    archive.append(Buffer.from(bufFees), { name: '06_Platform_Fees/Platform_Fee_Details.xlsx' });

    // G. 07_Coupons_and_Discounts/Coupons.xlsx
    const wbCoupons = new ExcelJS.Workbook();
    SellerDataExportService.buildCouponsSheet(wbCoupons, { promotions });
    const bufCoupons = await wbCoupons.xlsx.writeBuffer();
    archive.append(Buffer.from(bufCoupons), { name: '07_Coupons_and_Discounts/Coupons.xlsx' });

    // I. 09_Analytics/Sales_Summary.xlsx, Monthly_Sales.xlsx, Product_Performance.xlsx
    const wbSalesSum = new ExcelJS.Workbook();
    SellerDataExportService.buildSalesSummarySheet(wbSalesSum, { orders, ledger, payouts });
    const bufSalesSum = await wbSalesSum.xlsx.writeBuffer();
    archive.append(Buffer.from(bufSalesSum), { name: '09_Analytics/Sales_Summary.xlsx' });

    const wbMonthSales = new ExcelJS.Workbook();
    SellerDataExportService.buildMonthlySalesSheet(wbMonthSales, { orders, ledger, payouts });
    const bufMonthSales = await wbMonthSales.xlsx.writeBuffer();
    archive.append(Buffer.from(bufMonthSales), { name: '09_Analytics/Monthly_Sales.xlsx' });

    const wbProdPerf = new ExcelJS.Workbook();
    SellerDataExportService.buildProductPerformanceSheet(wbProdPerf, { orders, listings });
    const bufProdPerf = await wbProdPerf.xlsx.writeBuffer();
    archive.append(Buffer.from(bufProdPerf), { name: '09_Analytics/Product_Performance.xlsx' });

    // 3. Generate PDF Invoices and Statements
    job.status = 'GENERATING_PDFS';
    job.stepText = 'Generating PDF invoices and statements...';
    job.progressPercent = 70;

    let totalInvoicesPdfCount = 0;

    // H1. Order Invoices (PDFs for delivered / paid orders, limit up to latest 50 to keep zip generation responsive)
    const eligibleOrders = orders.filter((o) => o.status === 'DELIVERED' || o.paymentStatus === 'PAID');
    const orderSample = eligibleOrders.slice(0, 50);

    for (const ord of orderSample) {
      try {
        const invData = await SellerInvoiceService.getOrderInvoiceData(sellerId, ord.orderNumber);
        const pdfBuf = await SellerDataExportService.renderOrderInvoicePdf(invData);
        archive.append(pdfBuf, { name: `08_Invoices/Order_Invoices/Invoice_${ord.orderNumber}.pdf` });
        totalInvoicesPdfCount++;
      } catch (err: any) {
        logger.warn('Could not render order invoice PDF for export:', { orderNumber: ord.orderNumber, error: err?.message });
      }
    }

    // H2. Seller Invoices (Platform Commission Invoices)
    if (payouts.length > 0) {
      for (const p of payouts.slice(0, 30)) {
        try {
          const commData = await SellerInvoiceService.getCommissionInvoiceData(sellerId, p.payoutId);
          const pdfBuf = await SellerDataExportService.renderCommissionInvoicePdf(commData);
          archive.append(pdfBuf, { name: `08_Invoices/Seller_Invoices/Platform_Fee_Invoice_${p.payoutId}.pdf` });
          totalInvoicesPdfCount++;
        } catch (err: any) {
          logger.warn('Could not render commission invoice PDF for export:', { payoutId: p.payoutId, error: err?.message });
        }
      }
    } else {
      // General commission statement to date
      try {
        const commData = await SellerInvoiceService.getCommissionInvoiceData(sellerId);
        const pdfBuf = await SellerDataExportService.renderCommissionInvoicePdf(commData);
        archive.append(pdfBuf, { name: '08_Invoices/Seller_Invoices/Platform_Fee_Statement_Summary.pdf' });
        totalInvoicesPdfCount++;
      } catch (err: any) {
        logger.warn('Could not render platform fee summary invoice:', err?.message);
      }
    }

    // H3. Credit Notes (for orders with refunds)
    const refundedOrders = orders.filter((o) => o.refunds && o.refunds.length > 0);
    for (const ord of refundedOrders.slice(0, 25)) {
      try {
        const cnBuf = await SellerDataExportService.renderCreditNotePdf(ord, onboarding);
        archive.append(cnBuf, { name: `08_Invoices/Credit_Notes/Credit_Note_${ord.orderNumber}.pdf` });
        totalInvoicesPdfCount++;
      } catch (err: any) {
        logger.warn('Could not render credit note PDF for export:', { orderNumber: ord.orderNumber, error: err?.message });
      }
    }

    // J. 04. Export Summary PDF
    const summaryStats = {
      productsCount: (listings?.length || 0) + (submissions?.length || 0),
      inventoryCount: inventory?.length || 0,
      ordersCount: orders?.length || 0,
      orderItemsCount: orders.reduce((sum, o) => sum + (o.items?.length || 0), 0),
      ledgerCount: ledger?.length || 0,
      payoutsCount: payouts?.length || 0,
      couponsCount: promotions?.length || 0,
      invoicesCount: totalInvoicesPdfCount,
    };

    const summaryPdfBuf = await SellerDataExportService.renderExportSummaryPdf({
      seller,
      onboarding,
      sellerId,
      now,
      stats: summaryStats,
    });
    archive.append(summaryPdfBuf, { name: 'Export_Summary.pdf' });

    // 4. Finalize ZIP File
    job.status = 'CREATING_ZIP';
    job.stepText = 'Compressing business archive...';
    job.progressPercent = 90;

    await archive.finalize();
    await archiveClosedPromise;

    const stat = fs.statSync(zipFilePath);
    const downloadToken = crypto.randomBytes(24).toString('hex');

    job.status = 'READY_TO_DOWNLOAD';
    job.stepText = 'Ready to download';
    job.progressPercent = 100;
    job.fileName = zipFileName;
    job.fileSizeBytes = stat.size;
    job.fileSizeFormatted = formatFileSize(stat.size);
    job.downloadToken = downloadToken;
    job.downloadUrl = `/seller/business-data-export/download/${downloadToken}`;
    job.filePath = zipFilePath;
    job.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    job.summaryStats = summaryStats;

    tokenToJobMap.set(downloadToken, job);

    logger.info('Seller business data export created successfully:', {
      sellerId,
      zipFileName,
      sizeBytes: stat.size,
    });

    // Cleanup old files older than 24 hours
    SellerDataExportService.cleanupOldExports();
  }

  /* ------------------------------------------------------------------ */
  /*  Excel Builders for Each Category                                  */
  /* ------------------------------------------------------------------ */

  private static buildStoreDetailsSheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Store Details');
    ws.columns = [
      { header: 'Parameter', key: 'param', width: 26 },
      { header: 'Value', key: 'value', width: 38 },
      { header: 'Details / Notes', key: 'notes', width: 34 },
    ];
    styleHeaderRow(ws.getRow(1));

    const s = data.seller;
    const ob = data.onboarding;
    const st = data.storeSettings;

    const fullAddr = [
      ob?.address,
      ob?.streetRoad,
      ob?.locality || ob?.area,
      ob?.city,
      ob?.district,
      ob?.state,
      ob?.pincode,
    ]
      .filter(Boolean)
      .join(', ');

    const rows = [
      { param: 'Store Name', value: ob?.shopName || 'ExtraHand Store', notes: 'Public trading name' },
      { param: 'Store ID', value: String(s?._id || ob?.sellerId || ''), notes: 'ExtraHand internal store identifier' },
      { param: 'Owner Name', value: ob?.fullName || s?.fullName || '-', notes: 'Registered proprietor / contact' },
      { param: 'Registered Phone', value: maskPhone(s?.mobileNumber || ob?.mobileNumber), notes: 'Primary contact number' },
      { param: 'Store Contact Email', value: ob?.shopEmail || s?.email || '-', notes: 'Support email' },
      { param: 'Store Address', value: fullAddr || ob?.formattedAddress || '-', notes: 'Pickup & billing address' },
      { param: 'City & State', value: `${ob?.city || '-'}, ${ob?.state || 'Telangana'}`, notes: 'Registered location' },
      { param: 'Pincode', value: ob?.pincode || '-', notes: 'Postal zone' },
      { param: 'Category', value: ob?.category || 'Quick Commerce', notes: 'Main operating vertical' },
      { param: 'Subcategory', value: ob?.subcategory || '-', notes: 'Business specialization' },
      { param: 'Store Timings', value: ob?.openingHours || (st?.openTime ? `${st.openTime} - ${st.closeTime}` : '08:00 AM - 10:00 PM'), notes: 'Store operating hours' },
      { param: 'Store Status', value: st?.storeStatus === 'open' ? 'OPEN' : 'CLOSED', notes: 'Current operational state' },
      { param: 'Registration Date', value: formatIST(s?.createdAt || ob?.createdAt), notes: 'Account inception timestamp' },
      { param: 'Account Status', value: s?.status || 'ACTIVE', notes: 'Platform approval status' },
      { param: 'GSTIN', value: ob?.gstin || (ob?.gstinApplicable === false ? 'Exempt / Not Applicable' : 'Not Provided'), notes: 'Goods & Services Tax ID' },
      { param: 'FSSAI License', value: ob?.fssaiNumber || 'Not Applicable', notes: 'Food safety registration' },
      { param: 'Settlement Bank', value: ob?.bankAccount?.bankName || st?.bankAccount?.bankName || 'Verified Bank', notes: 'Daily payout institution' },
      { param: 'Bank Account Number', value: maskBankAccount(ob?.bankAccount?.accountNumber || st?.bankAccount?.accountNumber), notes: 'Masked for security' },
      { param: 'Bank IFSC Code', value: ob?.bankAccount?.ifscCode || st?.bankAccount?.ifscCode || '-', notes: 'Bank branch code' },
    ];

    rows.forEach((r) => ws.addRow(r));
    autoFitColumns(ws);
  }

  private static buildProductsSheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Products');
    ws.columns = [
      { header: 'Product ID', key: 'id', width: 22 },
      { header: 'Product Name', key: 'name', width: 32 },
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Subcategory', key: 'subcategory', width: 20 },
      { header: 'Product Type', key: 'type', width: 16 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Unit / Pack', key: 'unit', width: 14 },
      { header: 'Selling Price (INR)', key: 'sellingPrice', width: 18 },
      { header: 'MRP / Compare Price (INR)', key: 'mrp', width: 22 },
      { header: 'Listing Status', key: 'status', width: 16 },
      { header: 'Approval Status', key: 'approval', width: 16 },
      { header: 'Available Stock', key: 'stock', width: 16 },
      { header: 'Created Date (IST)', key: 'created', width: 20 },
      { header: 'Last Updated (IST)', key: 'updated', width: 20 },
    ];
    styleHeaderRow(ws.getRow(1));

    // Catalogue Listings
    for (const l of data.listings || []) {
      const mp = l.masterProductId as any;
      ws.addRow({
        id: String(l._id || ''),
        name: mp?.name || 'Catalogue Product',
        description: l.customDescription || mp?.description || '-',
        category: mp?.categoryName || mp?.categoryId?.name || 'Grocery',
        subcategory: mp?.subcategoryName || mp?.subcategoryId?.name || '-',
        type: 'Catalogue Product',
        sku: l.sellerSku || mp?.sku || '-',
        unit: l.unit || mp?.unit || '-',
        sellingPrice: Number(formatRupees(l.sellingPricePaise)),
        mrp: Number(formatRupees(l.compareAtPricePaise || mp?.sellingPricePaise)),
        status: l.status || 'ACTIVE',
        approval: l.reviewStatus || 'APPROVED',
        stock: l.stock || l.available || 0,
        created: formatIST(l.createdAt),
        updated: formatIST(l.updatedAt),
      });
    }

    // Custom Product Submissions
    for (const sub of data.submissions || []) {
      ws.addRow({
        id: String(sub._id || ''),
        name: sub.submittedProductName || 'Custom Product',
        description: sub.description || '-',
        category: sub.categoryName || 'Custom Category',
        subcategory: sub.subcategoryName || '-',
        type: 'Custom Store Product',
        sku: '-',
        unit: sub.packOrSoldAs || sub.unit || '-',
        sellingPrice: Number(formatRupees(sub.sellingPricePaise)),
        mrp: Number(formatRupees(sub.sellingPricePaise)),
        status: sub.status === 'APPROVED' ? 'ACTIVE' : 'DRAFT',
        approval: sub.status || 'PENDING',
        stock: sub.quantity || 0,
        created: formatIST(sub.createdAt),
        updated: formatIST(sub.updatedAt),
      });
    }

    if (!data.listings?.length && !data.submissions?.length) {
      ws.addRow({ id: 'NO_RECORDS', name: 'No products found in catalogue' });
    }

    autoFitColumns(ws);
  }

  private static buildCurrentInventorySheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Current Inventory');
    ws.columns = [
      { header: 'Product ID', key: 'id', width: 22 },
      { header: 'Product Name', key: 'name', width: 32 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Physical Stock', key: 'stock', width: 16 },
      { header: 'Reserved Stock', key: 'reserved', width: 16 },
      { header: 'Available Stock', key: 'available', width: 16 },
      { header: 'Stock Status', key: 'status', width: 16 },
      { header: 'Location / Warehouse', key: 'location', width: 22 },
      { header: 'Last Updated (IST)', key: 'updated', width: 20 },
    ];
    styleHeaderRow(ws.getRow(1));

    const records = data.inventory && data.inventory.length > 0 ? data.inventory : data.listings || [];

    for (const inv of records) {
      const mp = (inv.masterProductId as any) || {};
      const stock = inv.stock || 0;
      const reserved = inv.reserved || 0;
      const available = Math.max(0, stock - reserved);
      const status = available === 0 ? 'Out of Stock' : available <= 5 ? 'Low Stock' : 'In Stock';

      ws.addRow({
        id: String(inv._id || inv.listingId || ''),
        name: mp.name || inv.productName || 'Store Product',
        sku: inv.sellerSku || mp.sku || '-',
        stock,
        reserved,
        available,
        status,
        location: inv.locationName || 'Main Storefront',
        updated: formatIST(inv.updatedAt),
      });
    }

    if (!records.length) {
      ws.addRow({ id: 'NO_RECORDS', name: 'No inventory items recorded' });
    }

    autoFitColumns(ws);
  }

  private static buildStockHistorySheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Stock History');
    ws.columns = [
      { header: 'Product ID', key: 'id', width: 22 },
      { header: 'Product Name', key: 'name', width: 30 },
      { header: 'Current Available Stock', key: 'currentStock', width: 22 },
      { header: 'Previous Stock Qty', key: 'prevStock', width: 20 },
      { header: 'Stock Added', key: 'added', width: 14 },
      { header: 'Stock Reduced', key: 'reduced', width: 14 },
      { header: 'Adjustment Reason', key: 'reason', width: 28 },
      { header: 'Event Date & Time (IST)', key: 'eventTime', width: 22 },
      { header: 'Out-of-Stock Status', key: 'oosStatus', width: 20 },
    ];
    styleHeaderRow(ws.getRow(1));

    let rowCount = 0;

    // Derived from Order Reservations
    for (const ord of data.orders || []) {
      for (const it of ord.items || []) {
        ws.addRow({
          id: String(it.masterProductId || ord._id),
          name: it.name || 'Ordered Product',
          currentStock: '-',
          prevStock: '-',
          added: 0,
          reduced: it.quantity || 1,
          reason: `Fulfilment for Order #${ord.orderNumber}`,
          eventTime: formatIST(ord.createdAt),
          oosStatus: 'In Stock',
        });
        rowCount++;
        if (rowCount >= 200) break;
      }
      if (rowCount >= 200) break;
    }

    // Derived from price & review logs
    for (const log of data.priceLogs || []) {
      ws.addRow({
        id: String(log.masterProductId || log._id),
        name: 'Catalogue Product',
        currentStock: '-',
        prevStock: '-',
        added: '-',
        reduced: '-',
        reason: `Price/Unit update: ${log.status} (${log.rejectionReason || 'Admin Approved'})`,
        eventTime: formatIST(log.createdAt),
        oosStatus: 'In Stock',
      });
      rowCount++;
    }

    if (rowCount === 0) {
      ws.addRow({ id: 'NO_RECORDS', name: 'No stock adjustments recorded' });
    }

    autoFitColumns(ws);
  }

  private static buildCompleteOrdersSheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Complete Orders');
    ws.columns = [
      { header: 'Order ID / Number', key: 'orderNumber', width: 20 },
      { header: 'Order Date & Time (IST)', key: 'date', width: 22 },
      { header: 'Order Status', key: 'status', width: 16 },
      { header: 'Fulfilment Status', key: 'fulfillment', width: 18 },
      { header: 'Items Count', key: 'itemsCount', width: 14 },
      { header: 'Customer Name', key: 'customer', width: 22 },
      { header: 'Delivery Area / City', key: 'area', width: 24 },
      { header: 'Items Subtotal (INR)', key: 'subtotal', width: 18 },
      { header: 'Delivery Fee (INR)', key: 'deliveryFee', width: 16 },
      { header: 'Coupon Discount (INR)', key: 'discount', width: 20 },
      { header: 'Total Customer Paid (INR)', key: 'totalAmount', width: 24 },
      { header: 'Seller Gross Amount (INR)', key: 'sellerGross', width: 24 },
      { header: 'Platform Fee (INR)', key: 'platformFee', width: 18 },
      { header: 'Net Seller Payable (INR)', key: 'netPayable', width: 22 },
      { header: 'Refund Amount (INR)', key: 'refund', width: 18 },
      { header: 'Cancellation / Reject Reason', key: 'rejectReason', width: 30 },
      { header: 'Order Completed Date (IST)', key: 'completedAt', width: 22 },
    ];
    styleHeaderRow(ws.getRow(1));

    for (const o of data.orders || []) {
      const itemsCount = o.items ? o.items.reduce((sum: number, it: any) => sum + (it.quantity || 1), 0) : 0;
      const subtotal = Number(formatRupees(o.itemTotalPaise));
      const deliveryFee = Number(formatRupees(o.deliveryFeePaise));
      const discount = Number(formatRupees(o.couponDiscountPaise));
      const totalAmount = Number(formatRupees(o.amountPaise));

      // Compute platform fee & net from items or seller gross
      let platformFeePaise = 0;
      for (const it of o.items || []) {
        platformFeePaise += it.platformFeePaise || 0;
      }
      const sellerGrossPaise = o.itemTotalPaise || 0;
      const netPayablePaise = Math.max(0, sellerGrossPaise - platformFeePaise);

      const refundPaise = (o.refunds || []).reduce((sum: number, r: any) => sum + (r.amountPaise || 0), 0);

      ws.addRow({
        orderNumber: o.orderNumber || String(o._id),
        date: formatIST(o.createdAt),
        status: o.status || 'COMPLETED',
        fulfillment: o.fulfillmentStatus || '-',
        itemsCount,
        customer: maskCustomerName(o.address?.name || (o as any).customer?.name),
        area: `${o.address?.line2 || o.address?.city || 'Local Area'}, ${o.address?.city || 'City'}`,
        subtotal,
        deliveryFee,
        discount,
        totalAmount,
        sellerGross: Number(formatRupees(sellerGrossPaise)),
        platformFee: Number(formatRupees(platformFeePaise)),
        netPayable: Number(formatRupees(netPayablePaise)),
        refund: Number(formatRupees(refundPaise)),
        rejectReason: o.rejectedReason || o.rejectedNote || '-',
        completedAt: formatIST(o.readyAt || o.acceptedAt || o.updatedAt),
      });
    }

    if (!data.orders?.length) {
      ws.addRow({ orderNumber: 'NO_RECORDS', status: 'No orders recorded for this store' });
    }

    autoFitColumns(ws);
  }

  private static buildOrderItemsSheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Order Items');
    ws.columns = [
      { header: 'Order Number', key: 'orderNumber', width: 20 },
      { header: 'Order Date (IST)', key: 'date', width: 20 },
      { header: 'Product ID / Slug', key: 'slug', width: 22 },
      { header: 'Product Name', key: 'name', width: 32 },
      { header: 'Unit / Pack Size', key: 'unit', width: 16 },
      { header: 'Quantity Ordered', key: 'qty', width: 16 },
      { header: 'Selling Price (INR)', key: 'sellingPrice', width: 18 },
      { header: 'MRP (INR)', key: 'mrp', width: 16 },
      { header: 'Item Subtotal (INR)', key: 'subtotal', width: 18 },
      { header: 'Item Discount (INR)', key: 'discount', width: 18 },
      { header: 'Line Total (INR)', key: 'lineTotal', width: 18 },
      { header: 'Platform Fee Rate (%)', key: 'feeRate', width: 20 },
      { header: 'Platform Fee (INR)', key: 'feeAmount', width: 18 },
    ];
    styleHeaderRow(ws.getRow(1));

    let count = 0;
    for (const o of data.orders || []) {
      for (const it of o.items || []) {
        const unitPrice = Number(formatRupees(it.unitPricePaise));
        const mrp = Number(formatRupees(it.mrpPaise || it.unitPricePaise));
        const lineTotal = Number(formatRupees(it.lineTotalPaise || (it.unitPricePaise * it.quantity)));
        const savings = Number(formatRupees(it.savingsPaise));
        const feeAmount = Number(formatRupees(it.platformFeePaise));

        ws.addRow({
          orderNumber: o.orderNumber || String(o._id),
          date: formatDateIST(o.createdAt),
          slug: it.productSlug || String(it.masterProductId || ''),
          name: it.name || 'Store Item',
          unit: it.unit || '-',
          qty: it.quantity || 1,
          sellingPrice: unitPrice,
          mrp,
          subtotal: lineTotal + savings,
          discount: savings,
          lineTotal,
          feeRate: it.platformFeePercent ? `${it.platformFeePercent}%` : '5%',
          feeAmount,
        });
        count++;
      }
    }

    if (count === 0) {
      ws.addRow({ orderNumber: 'NO_RECORDS', name: 'No order items recorded' });
    }

    autoFitColumns(ws);
  }

  private static buildPaymentHistorySheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Payment History');
    ws.columns = [
      { header: 'Transaction ID', key: 'id', width: 22 },
      { header: 'Order ID / Number', key: 'orderNumber', width: 20 },
      { header: 'Transaction Type', key: 'type', width: 22 },
      { header: 'Gross Amount (INR)', key: 'gross', width: 18 },
      { header: 'Platform Commission (INR)', key: 'commission', width: 24 },
      { header: 'GST on Commission (INR)', key: 'tax', width: 22 },
      { header: 'Adjustments / Deductions (INR)', key: 'adj', width: 26 },
      { header: 'Net Amount (INR)', key: 'net', width: 18 },
      { header: 'Settlement Status', key: 'status', width: 18 },
      { header: 'Transaction Date (IST)', key: 'date', width: 22 },
      { header: 'Settled Date (IST)', key: 'settledDate', width: 22 },
      { header: 'Payout Reference', key: 'payoutRef', width: 22 },
    ];
    styleHeaderRow(ws.getRow(1));

    for (const leg of data.ledger || []) {
      ws.addRow({
        id: String(leg._id || ''),
        orderNumber: leg.orderNumber || '-',
        type: leg.transactionType || 'ORDER_SALE',
        gross: Number(formatRupees(leg.grossAmountPaise)),
        commission: Number(formatRupees(leg.commissionAmountPaise)),
        tax: Number(formatRupees(leg.taxOnCommissionPaise)),
        adj: Number(formatRupees(leg.adjustmentAmountPaise)),
        net: Number(formatRupees(leg.netAmountPaise)),
        status: leg.status || 'AVAILABLE',
        date: formatIST(leg.createdAt),
        settledDate: formatIST(leg.settledAt),
        payoutRef: leg.payoutId || leg.paymentId || '-',
      });
    }

    if (!data.ledger?.length) {
      ws.addRow({ id: 'NO_RECORDS', type: 'No ledger transactions recorded' });
    }

    autoFitColumns(ws);
  }

  private static buildSettlementHistorySheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Settlement History');
    ws.columns = [
      { header: 'Payout ID', key: 'payoutId', width: 22 },
      { header: 'Settlement Amount (INR)', key: 'amount', width: 24 },
      { header: 'Payout Status', key: 'status', width: 18 },
      { header: 'Bank Name', key: 'bankName', width: 22 },
      { header: 'Account Holder', key: 'holder', width: 22 },
      { header: 'Bank Account Number', key: 'acc', width: 22 },
      { header: 'Bank IFSC Code', key: 'ifsc', width: 18 },
      { header: 'Bank UTR / Reference', key: 'ref', width: 24 },
      { header: 'Requested Date (IST)', key: 'requested', width: 22 },
      { header: 'Processed Date (IST)', key: 'processed', width: 22 },
      { header: 'Settled Date (IST)', key: 'settled', width: 22 },
      { header: 'Failure Reason (if any)', key: 'failure', width: 28 },
    ];
    styleHeaderRow(ws.getRow(1));

    for (const p of data.payouts || []) {
      ws.addRow({
        payoutId: p.payoutId || String(p._id),
        amount: Number(formatRupees(p.amountPaise)),
        status: p.status || 'COMPLETED',
        bankName: p.bankAccount?.bankName || 'Verified Bank',
        holder: p.bankAccount?.accountHolderName || '-',
        acc: p.bankAccount?.accountNumberMasked || '•••• 1234',
        ifsc: p.bankAccount?.ifscCode || '-',
        ref: p.referenceNumber || p.gatewayPayoutId || '-',
        requested: formatIST(p.requestedAt || p.createdAt),
        processed: formatIST(p.processedAt),
        settled: formatIST(p.settledAt),
        failure: p.failureReason || '-',
      });
    }

    if (!data.payouts?.length) {
      ws.addRow({ payoutId: 'NO_RECORDS', status: 'No payouts or settlements requested yet' });
    }

    autoFitColumns(ws);
  }

  private static buildPlatformFeeSheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Platform Fee Details');
    ws.columns = [
      { header: 'Order ID / Number', key: 'orderNumber', width: 20 },
      { header: 'Order Date (IST)', key: 'date', width: 20 },
      { header: 'Order Gross Value (INR)', key: 'gross', width: 22 },
      { header: 'Platform Fee Rate (%)', key: 'rate', width: 20 },
      { header: 'Base Platform Fee (INR)', key: 'fee', width: 22 },
      { header: '18% GST on Fee (INR)', key: 'gst', width: 20 },
      { header: 'Total Platform Deduction (INR)', key: 'totalFee', width: 28 },
      { header: 'Calculation Basis', key: 'basis', width: 26 },
      { header: 'Related Settlement ID', key: 'settlementId', width: 22 },
      { header: 'Deduction Date (IST)', key: 'deductedAt', width: 22 },
    ];
    styleHeaderRow(ws.getRow(1));

    let rowCount = 0;
    for (const ord of data.orders || []) {
      let feePaise = 0;
      for (const it of ord.items || []) {
        feePaise += it.platformFeePaise || 0;
      }
      if (feePaise === 0 && ord.itemTotalPaise) {
        feePaise = Math.round(ord.itemTotalPaise * 0.05); // Standard 5% rate fallback
      }
      const gstPaise = Math.round(feePaise * 0.18);
      const totalFeePaise = feePaise + gstPaise;

      ws.addRow({
        orderNumber: ord.orderNumber || String(ord._id),
        date: formatDateIST(ord.createdAt),
        gross: Number(formatRupees(ord.itemTotalPaise)),
        rate: '5.0%',
        fee: Number(formatRupees(feePaise)),
        gst: Number(formatRupees(gstPaise)),
        totalFee: Number(formatRupees(totalFeePaise)),
        basis: 'Percentage on Delivered Item Subtotal',
        settlementId: ord.invoiceNumber || '-',
        deductedAt: formatIST(ord.readyAt || ord.acceptedAt || ord.createdAt),
      });
      rowCount++;
    }

    if (rowCount === 0) {
      ws.addRow({ orderNumber: 'NO_RECORDS', basis: 'No platform fee deductions recorded' });
    }

    autoFitColumns(ws);
  }

  private static buildCouponsSheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Coupons & Discounts');
    ws.columns = [
      { header: 'Coupon / Promotion ID', key: 'id', width: 24 },
      { header: 'Coupon Name / Description', key: 'name', width: 30 },
      { header: 'Discount Trigger', key: 'trigger', width: 18 },
      { header: 'Coupon Code', key: 'code', width: 18 },
      { header: 'Discount Type', key: 'type', width: 18 },
      { header: 'Discount Value', key: 'val', width: 16 },
      { header: 'Applicable Scope', key: 'scope', width: 22 },
      { header: 'Min Order Value (INR)', key: 'minOrder', width: 22 },
      { header: 'Max Discount Cap (INR)', key: 'maxDisc', width: 22 },
      { header: 'Usage Limit', key: 'limit', width: 14 },
      { header: 'Times Redeemed', key: 'used', width: 16 },
      { header: 'Total Discount Given (INR)', key: 'totalGiven', width: 26 },
      { header: 'Start Date (IST)', key: 'start', width: 20 },
      { header: 'Expiry Date (IST)', key: 'expiry', width: 20 },
      { header: 'Status', key: 'status', width: 16 },
    ];
    styleHeaderRow(ws.getRow(1));

    for (const p of data.promotions || []) {
      const isPercent = p.type === 'PERCENT';
      const valStr = isPercent ? `${p.value}%` : `₹${formatRupees(p.value)}`;

      ws.addRow({
        id: String(p._id || ''),
        name: p.description || 'Promotional Offer',
        trigger: p.trigger === 'CODE' ? 'Promo Code' : 'Automatic Offer',
        code: p.code || 'NO_CODE_REQUIRED',
        type: isPercent ? 'Percentage Discount' : 'Flat Discount',
        val: valStr,
        scope: p.appliesTo === 'PRODUCTS' ? 'Selected Products' : 'Entire Order',
        minOrder: Number(formatRupees(p.minOrderPaise)),
        maxDisc: p.maxDiscountPaise ? Number(formatRupees(p.maxDiscountPaise)) : 'No Cap',
        limit: p.usageLimit || 'Unlimited',
        used: p.usedCount || 0,
        totalGiven: Number(formatRupees(p.totalDiscountGivenPaise)),
        start: formatIST(p.startsAt),
        expiry: formatIST(p.endsAt),
        status: p.state || 'ACTIVE',
      });
    }

    if (!data.promotions?.length) {
      ws.addRow({ id: 'NO_RECORDS', name: 'No coupons or promotional discounts created' });
    }

    autoFitColumns(ws);
  }

  private static buildSalesSummarySheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Sales Summary');
    ws.columns = [
      { header: 'Metric / Key Performance Indicator', key: 'kpi', width: 34 },
      { header: 'Value', key: 'val', width: 24 },
      { header: 'Unit / Currency', key: 'unit', width: 20 },
      { header: 'Notes', key: 'notes', width: 36 },
    ];
    styleHeaderRow(ws.getRow(1));

    const totalOrders = data.orders?.length || 0;
    const completedOrders = data.orders?.filter((o: any) => o.status === 'DELIVERED').length || 0;
    const cancelledOrders = data.orders?.filter((o: any) => o.status === 'CANCELLED' || o.status === 'FAILED').length || 0;

    let totalGrossSalesPaise = 0;
    let totalDiscountPaise = 0;
    let totalPlatformFeePaise = 0;

    for (const o of data.orders || []) {
      totalGrossSalesPaise += o.itemTotalPaise || 0;
      totalDiscountPaise += o.couponDiscountPaise || 0;
      for (const it of o.items || []) {
        totalPlatformFeePaise += it.platformFeePaise || 0;
      }
    }

    const netSellerEarningsPaise = Math.max(0, totalGrossSalesPaise - totalPlatformFeePaise);
    const totalPayoutsPaise = (data.payouts || []).reduce((sum: number, p: any) => sum + (p.amountPaise || 0), 0);

    const rows = [
      { kpi: 'Total Orders Placed', val: totalOrders, unit: 'Orders', notes: 'All orders received by this store' },
      { kpi: 'Completed Orders', val: completedOrders, unit: 'Orders', notes: 'Successfully delivered to customer' },
      { kpi: 'Cancelled / Rejected Orders', val: cancelledOrders, unit: 'Orders', notes: 'Cancelled by customer or rejected' },
      { kpi: 'Total Gross Sales', val: formatRupees(totalGrossSalesPaise), unit: 'INR (₹)', notes: 'Cumulative order item value' },
      { kpi: 'Total Promotional Discounts', val: formatRupees(totalDiscountPaise), unit: 'INR (₹)', notes: 'Coupons and promotional discounts given' },
      { kpi: 'Total Platform Commission Deductions', val: formatRupees(totalPlatformFeePaise), unit: 'INR (₹)', notes: 'ExtraHand marketplace platform fees' },
      { kpi: 'Net Seller Earnings', val: formatRupees(netSellerEarningsPaise), unit: 'INR (₹)', notes: 'Gross sales minus platform commissions' },
      { kpi: 'Total Bank Payouts Settled', val: formatRupees(totalPayoutsPaise), unit: 'INR (₹)', notes: 'Transferred directly to seller bank account' },
    ];

    rows.forEach((r) => ws.addRow(r));
    autoFitColumns(ws);
  }

  private static buildMonthlySalesSheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Monthly Sales');
    ws.columns = [
      { header: 'Month / Year', key: 'monthYear', width: 18 },
      { header: 'Total Orders', key: 'ordersCount', width: 16 },
      { header: 'Completed Orders', key: 'completedCount', width: 18 },
      { header: 'Gross Sales (INR)', key: 'gross', width: 20 },
      { header: 'Discounts (INR)', key: 'discounts', width: 18 },
      { header: 'Platform Fees (INR)', key: 'fees', width: 20 },
      { header: 'Net Earnings (INR)', key: 'net', width: 20 },
      { header: 'Payouts Settled (INR)', key: 'payouts', width: 22 },
    ];
    styleHeaderRow(ws.getRow(1));

    // Group by YYYY-MM
    const monthlyMap: Record<string, { orders: number; completed: number; gross: number; discounts: number; fees: number }> = {};

    for (const o of data.orders || []) {
      const d = new Date(o.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) {
        monthlyMap[key] = { orders: 0, completed: 0, gross: 0, discounts: 0, fees: 0 };
      }
      monthlyMap[key].orders++;
      if (o.status === 'DELIVERED') monthlyMap[key].completed++;
      monthlyMap[key].gross += o.itemTotalPaise || 0;
      monthlyMap[key].discounts += o.couponDiscountPaise || 0;
      for (const it of o.items || []) {
        monthlyMap[key].fees += it.platformFeePaise || 0;
      }
    }

    const sortedMonths = Object.keys(monthlyMap).sort().reverse();

    for (const m of sortedMonths) {
      const stat = monthlyMap[m];
      const net = Math.max(0, stat.gross - stat.fees);
      ws.addRow({
        monthYear: m,
        ordersCount: stat.orders,
        completedCount: stat.completed,
        gross: Number(formatRupees(stat.gross)),
        discounts: Number(formatRupees(stat.discounts)),
        fees: Number(formatRupees(stat.fees)),
        net: Number(formatRupees(net)),
        payouts: Number(formatRupees(net)),
      });
    }

    if (sortedMonths.length === 0) {
      ws.addRow({ monthYear: 'NO_RECORDS', ordersCount: 0 });
    }

    autoFitColumns(ws);
  }

  private static buildProductPerformanceSheet(wb: ExcelJS.Workbook, data: any) {
    const ws = wb.addWorksheet('Product Performance');
    ws.columns = [
      { header: 'Product ID / Slug', key: 'id', width: 22 },
      { header: 'Product Name', key: 'name', width: 32 },
      { header: 'Units Sold', key: 'unitsSold', width: 16 },
      { header: 'Total Revenue (INR)', key: 'revenue', width: 22 },
      { header: 'Average Selling Price (INR)', key: 'avgPrice', width: 26 },
      { header: 'Active Listing Status', key: 'status', width: 20 },
    ];
    styleHeaderRow(ws.getRow(1));

    const prodStats: Record<string, { name: string; units: number; revenuePaise: number }> = {};

    for (const o of data.orders || []) {
      if (o.status !== 'CANCELLED' && o.status !== 'FAILED') {
        for (const it of o.items || []) {
          const key = it.productSlug || String(it.masterProductId || it.name);
          if (!prodStats[key]) {
            prodStats[key] = { name: it.name, units: 0, revenuePaise: 0 };
          }
          const qty = it.quantity || 1;
          prodStats[key].units += qty;
          prodStats[key].revenuePaise += (it.unitPricePaise || 0) * qty;
        }
      }
    }

    const entries = Object.entries(prodStats).sort((a, b) => b[1].units - a[1].units);

    for (const [key, stat] of entries) {
      const avgPrice = stat.units > 0 ? (stat.revenuePaise / stat.units) : 0;
      ws.addRow({
        id: key,
        name: stat.name,
        unitsSold: stat.units,
        revenue: Number(formatRupees(stat.revenuePaise)),
        avgPrice: Number(formatRupees(avgPrice)),
        status: 'Active in History',
      });
    }

    if (entries.length === 0) {
      ws.addRow({ id: 'NO_RECORDS', name: 'No product sales recorded yet' });
    }

    autoFitColumns(ws);
  }

  /* ------------------------------------------------------------------ */
  /*  PDF Renderers with PDFKit                                         */
  /* ------------------------------------------------------------------ */

  private static renderExportSummaryPdf(data: any): Promise<Buffer> {
    return renderPdfToBuffer((doc) => {
      // Top Yellow Header Bar
      doc.rect(0, 0, 595.28, 48).fill('#FFCC30');

      doc.fillColor('#111827').fontSize(16).font('Helvetica-Bold').text('ExtraHand Seller Platform', 40, 16);
      doc.fontSize(10).font('Helvetica').text('Business Records Export Summary', 360, 20, { align: 'right' });

      doc.moveDown(2);
      doc.fillColor('#111827').fontSize(18).font('Helvetica-Bold').text('OFFICIAL BUSINESS DATA EXPORT');
      doc.fontSize(10).font('Helvetica-Oblique').fillColor('#4B5563').text(
        'Complete business archive generated under ExtraHand Merchant Terms of Service prior to account closure.'
      );
      doc.moveDown(1);

      // Store Details Box
      const ob = data.onboarding;
      const s = data.seller;

      doc.rect(40, doc.y, 515, 95).strokeColor('#D1D5DB').lineWidth(1).stroke();
      const boxY = doc.y + 10;

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Store Profile Information', 52, boxY);
      doc.font('Helvetica').fontSize(9).fillColor('#374151');
      doc.text(`Store Name: ${ob?.shopName || 'ExtraHand Partner Store'}`, 52, boxY + 20);
      doc.text(`Store ID: ${data.sellerId}`, 52, boxY + 34);
      doc.text(`Proprietor / Owner: ${ob?.fullName || s?.fullName || '-'}`, 52, boxY + 48);
      doc.text(`Registered Contact: ${maskPhone(s?.mobileNumber || ob?.mobileNumber)}`, 52, boxY + 62);

      doc.text(`Category: ${ob?.category || 'Quick Commerce'}`, 310, boxY + 20);
      doc.text(`Location: ${ob?.city || 'Hyderabad'}, ${ob?.state || 'Telangana'}`, 310, boxY + 34);
      doc.text(`GSTIN: ${ob?.gstin || (ob?.gstinApplicable === false ? 'Exempt' : 'Not Provided')}`, 310, boxY + 48);
      doc.text(`Export Timestamp: ${formatIST(data.now)}`, 310, boxY + 62);

      doc.y = boxY + 95;
      doc.moveDown(1);

      // Summary Statistics Table
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Export Category Summary');
      doc.moveDown(0.4);

      // Table Header
      const tableTop = doc.y;
      doc.rect(40, tableTop, 515, 20).fill('#F3F4F6');
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827');
      doc.text('Archive Folder / Section', 50, tableTop + 5);
      doc.text('Files Included', 230, tableTop + 5);
      doc.text('Record Count', 410, tableTop + 5);
      doc.text('Status', 490, tableTop + 5);

      const items = [
        { folder: '01_Store_Details', files: 'Store_Details.xlsx', count: '1 Store Profile', status: 'Exported' },
        { folder: '02_Product_Catalogue', files: 'Products.xlsx', count: `${data.stats.productsCount} Products`, status: 'Exported' },
        { folder: '03_Inventory', files: 'Current_Inventory.xlsx, Stock_History.xlsx', count: `${data.stats.inventoryCount} Records`, status: 'Exported' },
        { folder: '04_Order_History', files: 'Complete_Orders.xlsx, Order_Items.xlsx', count: `${data.stats.ordersCount} Orders (${data.stats.orderItemsCount} Items)`, status: 'Exported' },
        { folder: '05_Payments_and_Settlements', files: 'Payment_History.xlsx, Settlement_History.xlsx', count: `${data.stats.ledgerCount} Txns, ${data.stats.payoutsCount} Settlements`, status: 'Exported' },
        { folder: '06_Platform_Fees', files: 'Platform_Fee_Details.xlsx', count: `${data.stats.ordersCount} Deduction Lines`, status: 'Exported' },
        { folder: '07_Coupons_and_Discounts', files: 'Coupons.xlsx', count: `${data.stats.couponsCount} Promotions`, status: data.stats.couponsCount > 0 ? 'Exported' : 'None Available' },
        { folder: '08_Invoices', files: 'Seller_Invoices/, Order_Invoices/, Credit_Notes/', count: `${data.stats.invoicesCount} PDF Documents`, status: 'Exported' },
        { folder: '09_Analytics', files: 'Sales_Summary, Monthly_Sales, Product_Performance', count: '3 Spreadsheets', status: 'Exported' },
      ];

      let rowY = tableTop + 20;
      doc.font('Helvetica').fontSize(8.5).fillColor('#374151');

      items.forEach((it, idx) => {
        if (idx % 2 === 1) {
          doc.rect(40, rowY, 515, 18).fill('#FAFAFA');
        }
        doc.fillColor('#111827').font('Helvetica-Bold').text(it.folder, 50, rowY + 4, { width: 170 });
        doc.fillColor('#4B5563').font('Helvetica').text(it.files, 230, rowY + 4, { width: 170 });
        doc.fillColor('#111827').text(it.count, 410, rowY + 4);
        doc.fillColor(it.status === 'Exported' ? '#15803D' : '#9CA3AF').text(it.status, 490, rowY + 4);
        rowY += 18;
      });

      doc.y = rowY + 15;

      // Legal & Compliance Footer Box
      doc.rect(40, doc.y, 515, 80).fill('#FFFBEB');
      const noteY = doc.y + 10;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#B45309').text('Important Compliance & Legal Notice', 52, noteY);
      doc.font('Helvetica').fontSize(8).fillColor('#78350F').text(
        '1. This archive contains official copies of your business, tax, and sales transactions recorded on the ExtraHand Platform.\n' +
        '2. In accordance with applicable GST and financial regulations, transaction and tax invoice records must be maintained by the registered seller for a statutory period of up to 6 years.\n' +
        '3. All sensitive credentials, customer personal identifiers, and verification documentation have been masked or redacted to uphold privacy compliance.',
        52,
        noteY + 15,
        { width: 495, lineGap: 2 }
      );

      // Bottom Sign-off
      doc.fontSize(8).fillColor('#9CA3AF').text(
        'Generated securely by ExtraHand Q-Commerce Platform • https://extrahand.in • Support: support@extrahand.in',
        40,
        780,
        { align: 'center', width: 515 }
      );
    });
  }

  private static renderOrderInvoicePdf(inv: any): Promise<Buffer> {
    return renderPdfToBuffer((doc) => {
      // Header
      doc.rect(40, 36, 515, 45).fill('#FFF3C7');
      doc.fillColor('#111827').fontSize(14).font('Helvetica-Bold').text('ExtraHand', 50, 48);
      doc.fontSize(9).font('Helvetica').text(inv.invoiceTitle || 'TAX INVOICE', 320, 50, { align: 'right', width: 220 });

      doc.moveDown(2);
      doc.fontSize(8.5).fillColor('#4B5563').text(`Invoice Number: ${inv.invoiceNumber}`, 40, 95);
      doc.text(`Invoice Date: ${inv.invoiceDate}`, 40, 108);
      doc.text(`Order Number: ${inv.orderNumber}`, 40, 121);

      doc.text(`Seller: ${inv.seller?.tradeName || inv.seller?.legalName}`, 310, 95);
      doc.text(`GSTIN: ${inv.seller?.gstin || 'Not Applicable'}`, 310, 108);
      doc.text(`State: ${inv.seller?.state || 'Telangana'} (Code: ${inv.seller?.stateCode || '36'})`, 310, 121);

      // Items Table
      const tableY = 145;
      doc.rect(40, tableY, 515, 18).fill('#F3F4F6');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827');
      doc.text('Item Description', 48, tableY + 5);
      doc.text('Unit', 240, tableY + 5);
      doc.text('Qty', 300, tableY + 5);
      doc.text('Unit Price', 350, tableY + 5);
      doc.text('Total (INR)', 480, tableY + 5);

      let curY = tableY + 20;
      doc.font('Helvetica').fontSize(8).fillColor('#374151');

      for (const it of inv.items || []) {
        doc.text(it.name, 48, curY, { width: 185 });
        doc.text(it.unit || '-', 240, curY);
        doc.text(String(it.quantity || 1), 300, curY);
        doc.text(`Rs. ${formatRupees(it.unitPricePaise)}`, 350, curY);
        doc.text(`Rs. ${formatRupees(it.totalAmountPaise)}`, 480, curY);
        curY += 16;
      }

      doc.rect(40, curY, 515, 1).fill('#E5E7EB');
      curY += 8;

      // Totals
      const totals = inv.totals || {};
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111827');
      doc.text(`Subtotal: Rs. ${formatRupees(totals.subtotalPaise)}`, 350, curY, { align: 'right', width: 200 });
      curY += 14;
      if (totals.discountPaise) {
        doc.text(`Discount: - Rs. ${formatRupees(totals.discountPaise)}`, 350, curY, { align: 'right', width: 200 });
        curY += 14;
      }
      doc.fontSize(10).text(`Grand Total: Rs. ${formatRupees(totals.grandTotalPaise)}`, 350, curY, { align: 'right', width: 200 });
      curY += 24;

      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#6B7280').text(
        inv.statutoryDeclaration || 'This is an authentic computer-generated invoice issued by registered seller on ExtraHand.',
        40,
        curY,
        { width: 515 }
      );
    });
  }

  private static renderCommissionInvoicePdf(comm: any): Promise<Buffer> {
    return renderPdfToBuffer((doc) => {
      // Header
      doc.rect(40, 36, 515, 45).fill('#FDE68A');
      doc.fillColor('#111827').fontSize(14).font('Helvetica-Bold').text('ExtraHand Platform Commission Invoice', 50, 48);
      doc.fontSize(9).font('Helvetica').text(comm.invoiceNumber || 'EH-COMM-INV', 320, 50, { align: 'right', width: 220 });

      doc.moveDown(2);
      doc.fontSize(8.5).fillColor('#4B5563').text(`Invoice Number: ${comm.invoiceNumber}`, 40, 95);
      doc.text(`Invoice Date: ${comm.invoiceDate}`, 40, 108);
      doc.text(`Status: SETTLED`, 40, 121);

      doc.text(`Billed To (Merchant): ${comm.merchant?.tradeName || comm.merchant?.legalName || 'ExtraHand Seller'}`, 310, 95);
      doc.text(`GSTIN: ${comm.merchant?.gstin || 'Unregistered'}`, 310, 108);
      doc.text(`State: ${comm.merchant?.state || 'Telangana'}`, 310, 121);

      // Fee Breakdown Table
      const tableY = 145;
      doc.rect(40, tableY, 515, 18).fill('#F3F4F6');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111827');
      doc.text('Service Description (SAC: 998319)', 48, tableY + 5);
      doc.text('Taxable Value', 320, tableY + 5);
      doc.text('GST (18%)', 400, tableY + 5);
      doc.text('Total (INR)', 480, tableY + 5);

      const fees = comm.feeBreakdown || {};
      const commPaise = fees.totalCommissionPaise || 0;
      const gstPaise = fees.taxOnCommissionPaise || 0;
      const totalPaise = fees.totalInvoiceAmountPaise || (commPaise + gstPaise);

      const rowY = tableY + 22;
      doc.font('Helvetica').fontSize(8.5).fillColor('#374151');
      doc.text('ExtraHand Marketplace Platform Listing & Facilitation Services', 48, rowY, { width: 250 });
      doc.text(`Rs. ${formatRupees(commPaise)}`, 320, rowY);
      doc.text(`Rs. ${formatRupees(gstPaise)}`, 400, rowY);
      doc.text(`Rs. ${formatRupees(totalPaise)}`, 480, rowY);

      doc.rect(40, rowY + 22, 515, 1).fill('#E5E7EB');

      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(
        `Total Platform Fee Invoiced: Rs. ${formatRupees(totalPaise)}`,
        300,
        rowY + 30,
        { align: 'right', width: 250 }
      );
    });
  }

  private static renderCreditNotePdf(order: any, onboarding: any): Promise<Buffer> {
    return renderPdfToBuffer((doc) => {
      doc.rect(40, 36, 515, 45).fill('#FEE2E2');
      doc.fillColor('#991B1B').fontSize(14).font('Helvetica-Bold').text('ExtraHand Credit Note', 50, 48);
      doc.fontSize(9).font('Helvetica').text(`CN-${order.orderNumber}`, 320, 50, { align: 'right', width: 220 });

      doc.moveDown(2);
      const refund = order.refunds?.[0] || {};
      doc.fontSize(8.5).fillColor('#4B5563').text(`Credit Note ID: CN-${order.orderNumber}`, 40, 95);
      doc.text(`Original Order Ref: #${order.orderNumber}`, 40, 108);
      doc.text(`Date of Issue: ${formatIST(refund.at || order.updatedAt)}`, 40, 121);

      doc.text(`Seller Store: ${onboarding?.shopName || 'Registered Store'}`, 310, 95);
      doc.text(`Customer: ${maskCustomerName(order.address?.name)}`, 310, 108);
      doc.text(`Refund Status: ${refund.status || 'ISSUED'}`, 310, 121);

      const tableY = 145;
      doc.rect(40, tableY, 515, 18).fill('#F3F4F6');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111827');
      doc.text('Reason for Credit Note / Adjustment', 48, tableY + 5);
      doc.text('Refund Amount (INR)', 430, tableY + 5);

      const rowY = tableY + 24;
      doc.font('Helvetica').fontSize(8.5).fillColor('#374151');
      doc.text(`Order refund issued due to: ${refund.reason || order.rejectedReason || 'Customer Cancellation / Unfulfilled Item'}`, 48, rowY, { width: 360 });
      doc.text(`Rs. ${formatRupees(refund.amountPaise || order.amountPaise)}`, 430, rowY);

      doc.rect(40, rowY + 22, 515, 1).fill('#E5E7EB');
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#991B1B').text(
        `Total Credit Adjusted: Rs. ${formatRupees(refund.amountPaise || order.amountPaise)}`,
        300,
        rowY + 32,
        { align: 'right', width: 250 }
      );
    });
  }

  /**
   * Remove generated zip export files older than 24 hours.
   */
  private static cleanupOldExports() {
    try {
      if (!fs.existsSync(EXPORTS_DIR)) return;
      const files = fs.readdirSync(EXPORTS_DIR);
      const now = Date.now();
      const MAX_AGE_MS = 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.endsWith('.zip')) continue;
        const fullPath = path.join(EXPORTS_DIR, file);
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > MAX_AGE_MS) {
            fs.unlinkSync(fullPath);
            logger.info('Cleaned up expired export archive:', { file });
          }
        } catch {
          // ignore error on single file
        }
      }
    } catch (err: any) {
      logger.warn('Error during export cleanup:', err?.message);
    }
  }
}

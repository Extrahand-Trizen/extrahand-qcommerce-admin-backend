import mongoose, { Types } from 'mongoose';
import fs from 'fs';
import path from 'path';
import CustomerOrder, { ICustomerOrder } from '../models/CustomerOrder';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerDocument from '../models/SellerDocument';
import SellerPayout, { ISellerPayout } from '../models/SellerPayout';
import SellerLedger, { ISellerLedger } from '../models/SellerLedger';
import { AppError } from '../utils/response';
import logger from '../config/logger';

let cachedLogoDataUri = '';
function getLogoDataUri(): string {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  try {
    const candidates = [
      path.resolve(__dirname, '../assets/logo.png'),
      path.resolve(process.cwd(), 'src/assets/logo.png'),
      path.resolve(process.cwd(), '../extra-hand-seller/src/logo.png'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const b64 = fs.readFileSync(p).toString('base64');
        cachedLogoDataUri = `data:image/png;base64,${b64}`;
        break;
      }
    }
  } catch (err) {
    logger.warn('Failed to read logo.png for invoice template', err);
  }
  return cachedLogoDataUri;
}

export interface IInvoiceItem {
  name: string;
  variant?: string;
  quantity: number;
  unit?: string;
  hsnCode?: string;
  unitPricePaise: number;
  taxableAmountPaise: number;
  gstRatePercent: number;
  cgstPaise: number;
  sgstPaise: number;
  totalAmountPaise: number;
}

export interface IOrderInvoiceData {
  invoiceType: 'TAX_INVOICE' | 'COMMERCIAL_RECEIPT' | 'BILL_OF_SUPPLY';
  invoiceTitle: string;
  legalSubtitle: string;
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  orderPlacedAt: string;
  paymentMode: string;
  paymentStatus: string;
  transactionReference: string;
  placeOfSupply: string;
  seller: {
    legalName: string;
    tradeName: string;
    address: string;
    gstin?: string;
    fssaiNumber?: string;
    pan?: string;
    gstStatus: string;
    state: string;
    stateCode: string;
  };
  customer: {
    name: string;
    phone?: string;
    address: string;
    billingAddress: string;
    deliveryAddress: string;
    state: string;
    stateCode: string;
  };
  items: IInvoiceItem[];
  totals: {
    subtotalPaise: number;
    discountPaise: number;
    deliveryChargesPaise: number;
    totalTaxablePaise: number;
    cgstTotalPaise: number;
    sgstTotalPaise: number;
    totalTaxPaise: number;
    grandTotalPaise: number;
    amountInWords: string;
  };
  statutoryDeclaration: string;
}

/** Convert integer paise to formatted currency string (₹ XX.XX) */
function formatDateDDMMYYYY(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/** Number to Indian English words converter */
function numberToWords(num: number): string {
  if (num === 0) return 'Zero';
  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function inWords(n: number): string {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' and ' + inWords(n % 100) : '');
    if (n < 100000) return inWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + inWords(n % 1000) : '');
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 !== 0 ? ' ' + inWords(n % 100000) : '');
    return inWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 !== 0 ? ' ' + inWords(n % 10000000) : '');
  }

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  let result = inWords(rupees) + ' Rupees';
  if (paise > 0) {
    result += ' and ' + inWords(paise) + ' Paise';
  }
  return result + ' Only';
}

export class SellerInvoiceService {
  /**
   * Generates authoritative Seller-to-Customer Invoice data
   */
  static async getOrderInvoiceData(sellerId: string, orderIdOrNumber: string): Promise<IOrderInvoiceData> {
    const isObjectId = mongoose.Types.ObjectId.isValid(orderIdOrNumber);
    const query: Record<string, any> = {
      sellerId: new mongoose.Types.ObjectId(sellerId),
      ...(isObjectId ? { _id: orderIdOrNumber } : { orderNumber: orderIdOrNumber }),
    };

    const order = await CustomerOrder.findOne(query).lean();
    if (!order) {
      throw new AppError('Order not found for this seller', 404);
    }

    const onboarding = await SellerOnboarding.findOne({
      sellerId: new mongoose.Types.ObjectId(sellerId),
    }).lean();

    // Check for PAN and FSSAI from onboarding or uploaded documents
    let sellerPan: string | undefined = onboarding?.pan?.trim();
    let sellerFssai: string | undefined = onboarding?.fssaiNumber?.trim();

    if (!sellerPan || !sellerFssai) {
      const docs = await SellerDocument.find({
        sellerId: new mongoose.Types.ObjectId(sellerId),
        documentType: { $in: ['PAN_CARD', 'FSSAI_CERTIFICATE'] },
      }).lean();

      for (const doc of docs) {
        if (!sellerPan && doc.documentType === 'PAN_CARD' && doc.documentNumber?.trim()) {
          sellerPan = doc.documentNumber.trim();
        }
        if (!sellerFssai && doc.documentType === 'FSSAI_CERTIFICATE' && doc.documentNumber?.trim()) {
          sellerFssai = doc.documentNumber.trim();
        }
      }
    }

    if (!sellerPan && onboarding?.gstin && onboarding.gstin.trim().length === 15) {
      sellerPan = onboarding.gstin.trim().slice(2, 12);
    }

    const hasGstin = Boolean(
      onboarding?.gstinApplicable !== false &&
      onboarding?.gstin &&
      onboarding.gstin.trim().length === 15
    );

    const invoiceType = hasGstin ? 'TAX_INVOICE' : 'COMMERCIAL_RECEIPT';
    const invoiceTitle = hasGstin ? 'TAX INVOICE' : 'SALES INVOICE / RECEIPT';
    const legalSubtitle = hasGstin
      ? 'Issued under Section 31 of CGST Act, 2017 & Rule 46 of CGST Rules'
      : 'Commercial Sales Document – Unregistered Seller';

    const invPrefix = hasGstin ? 'EH-INV-' : 'EH-BOS-';
    const invoiceNumber = order.invoiceNumber || `${invPrefix}${order.orderNumber.replace(/^QC-/, '')}`;
    const rawDate = order.invoiceGeneratedAt ? new Date(order.invoiceGeneratedAt) : new Date(order.createdAt);
    const invoiceDate = hasGstin
      ? rawDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      : formatDateDDMMYYYY(rawDate);
    const orderPlacedAt = new Date(order.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const sellerLegalName = onboarding?.gstinVerifiedLegalName || onboarding?.shopName || 'Registered Seller';
    const sellerTradeName = onboarding?.gstinVerifiedTradeName || onboarding?.shopName || 'ExtraHand Partner Store';
    const sellerAddress = onboarding?.formattedAddress || onboarding?.address || 'Hyderabad, Telangana';
    const sellerState = onboarding?.state || 'Telangana';
    const sellerStateCode = '36'; // Default Telangana

    const custName = order.address?.name || (order as any).customer?.name || 'Customer';
    const custPhone = order.address?.phone || (order as any).customer?.phone;
    const custAddressParts = [
      order.address?.line1,
      order.address?.line2,
      order.address?.city,
      order.address?.pinCode,
    ].filter(Boolean);
    const custAddress = custAddressParts.length > 0 ? custAddressParts.join(', ') : 'Delivery Address';
    const custState = order.address?.city?.toLowerCase().includes('hyderabad') ? 'Telangana' : 'Telangana';

    // Calculate items & taxes
    let subtotalPaise = 0;
    let totalTaxablePaise = 0;
    let cgstTotalPaise = 0;
    let sgstTotalPaise = 0;

    const items: IInvoiceItem[] = (order.items || []).map((item) => {
      const qty = item.quantity || 1;
      const totalAmountPaise = (item.unitPricePaise || 0) * qty;
      subtotalPaise += totalAmountPaise;

      let hsn = (item as any).hsnCode;
      if (!hsn) {
        const cat = (item as any).categorySlug || '';
        if (cat.includes('fruit') || cat.includes('veg')) hsn = '0803 90 10';
        else if (cat.includes('dairy') || cat.includes('milk')) hsn = '0401 20 00';
        else if (cat.includes('staple') || cat.includes('atta')) hsn = '1101 00 00';
        else hsn = '2106 90 99';
      }

      if (hasGstin) {
        // Standard GST assumption for taxable goods (e.g. 5% for packaged staples/packaged food, 18% for personal care)
        const isExempt = ((item as any).categorySlug || '').includes('fruit') || ((item as any).categorySlug || '').includes('veg');
        const gstRate = isExempt ? 0 : 5;
        const taxableAmountPaise = gstRate > 0 ? Math.round(totalAmountPaise / (1 + gstRate / 100)) : totalAmountPaise;
        const totalTax = totalAmountPaise - taxableAmountPaise;
        const cgst = Math.round(totalTax / 2);
        const sgst = totalTax - cgst;

        totalTaxablePaise += taxableAmountPaise;
        cgstTotalPaise += cgst;
        sgstTotalPaise += sgst;

        return {
          name: item.name,
          variant: (item as any).variant || item.unit,
          quantity: qty,
          unit: item.unit || 'unit',
          hsnCode: hsn,
          unitPricePaise: item.unitPricePaise,
          taxableAmountPaise,
          gstRatePercent: gstRate,
          cgstPaise: cgst,
          sgstPaise: sgst,
          totalAmountPaise,
        };
      } else {
        totalTaxablePaise += totalAmountPaise;
        return {
          name: item.name,
          variant: (item as any).variant || item.unit,
          quantity: qty,
          unit: item.unit || 'unit',
          hsnCode: hsn,
          unitPricePaise: item.unitPricePaise,
          taxableAmountPaise: totalAmountPaise,
          gstRatePercent: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          totalAmountPaise,
        };
      }
    });

    const totalTaxPaise = cgstTotalPaise + sgstTotalPaise;
    const discountPaise = (order as any).couponDiscountPaise || 0;
    const deliveryChargesPaise = 0; // Seller invoice only covers product items sold; delivery fee excluded
    const grandTotalPaise = Math.max(0, subtotalPaise - discountPaise);
    const amountInWords = numberToWords(grandTotalPaise / 100);

    const statutoryDeclaration = hasGstin
      ? 'Whether tax is payable under Reverse Charge: NO. This is a computer generated invoice and does not require a physical signature.'
      : 'This document records a sale made by an unregistered seller. The seller is not registered under GST and has not collected GST separately on this transaction.\n\nComputer-generated commercial sales document.';

    const paymentStatus = ((order as any).paymentStatus || 'PAID').toUpperCase() === 'PAID' ? 'Paid' : 'Pending';
    const paymentMode = (order as any).paymentMethod || 'Online / UPI';
    const transactionReference = (order as any).razorpayPaymentId || (order as any).paymentId || order.orderNumber;

    return {
      invoiceType,
      invoiceTitle,
      legalSubtitle,
      invoiceNumber,
      invoiceDate,
      orderNumber: order.orderNumber,
      orderPlacedAt,
      paymentMode,
      paymentStatus,
      transactionReference,
      placeOfSupply: `${sellerState} (${sellerStateCode})`,
      seller: {
        legalName: sellerLegalName,
        tradeName: sellerTradeName,
        address: sellerAddress,
        gstin: hasGstin && onboarding?.gstin ? onboarding.gstin : 'Not Applicable',
        fssaiNumber: sellerFssai || 'Not Applicable',
        pan: sellerPan || 'Not Applicable',
        gstStatus: hasGstin ? 'Registered' : 'Unregistered',
        state: sellerState,
        stateCode: sellerStateCode,
      },
      customer: {
        name: custName,
        phone: custPhone,
        address: custAddress,
        billingAddress: custAddress,
        deliveryAddress: custAddress,
        state: custState,
        stateCode: '36',
      },
      items,
      totals: {
        subtotalPaise,
        discountPaise,
        deliveryChargesPaise,
        totalTaxablePaise,
        cgstTotalPaise,
        sgstTotalPaise,
        totalTaxPaise,
        grandTotalPaise,
        amountInWords,
      },
      statutoryDeclaration,
    };
  }

  /**
   * Returns standalone, printable HTML for the order invoice
   */
  static renderOrderInvoiceHtml(data: IOrderInvoiceData): string {
    const isTax = data.invoiceType === 'TAX_INVOICE';
    const docTitle = isTax ? 'Tax Invoice' : 'Bill of Supply';
    const totalQty = data.items.reduce((sum, it) => sum + (it.quantity || 1), 0);

    const itemRows = isTax
      ? data.items
          .map(
            (it, idx) => `
          <tr>
            <td style="text-align: center;">${idx + 1}</td>
            <td style="text-align: center; font-family: monospace;">${it.hsnCode || '-'}</td>
            <td><strong>${it.name}</strong>${it.variant ? `<br><span style="font-size: 10px; color: #555;">${it.variant}</span>` : ''}</td>
            <td style="text-align: right;">${formatRupees(it.unitPricePaise)}</td>
            <td style="text-align: right;">₹0.00</td>
            <td style="text-align: center; font-weight: bold;">${it.quantity}</td>
            <td style="text-align: right;">${formatRupees(it.taxableAmountPaise)}</td>
            <td style="text-align: right;">${(it.gstRatePercent / 2).toFixed(2)}</td>
            <td style="text-align: right;">${formatRupees(it.cgstPaise)}</td>
            <td style="text-align: right;">${(it.gstRatePercent / 2).toFixed(2)}</td>
            <td style="text-align: right;">${formatRupees(it.sgstPaise)}</td>
            <td style="text-align: right;">0.00</td>
            <td style="text-align: right;">0.00</td>
            <td style="text-align: right; font-weight: bold;">${formatRupees(it.totalAmountPaise)}</td>
          </tr>
        `,
          )
          .join('')
      : data.items
          .map(
            (it, idx) => `
          <tr>
            <td style="text-align: center; width: 40px;">${idx + 1}</td>
            <td><strong>${it.name}</strong>${it.variant ? `<br><span style="font-size: 10px; color: #555;">${it.variant}</span>` : ''}</td>
            <td style="text-align: center; font-weight: bold; width: 60px;">${it.quantity}</td>
            <td style="text-align: right; width: 100px;">${formatRupees(it.unitPricePaise)}</td>
            <td style="text-align: right; font-weight: bold; width: 110px;">${formatRupees(it.totalAmountPaise)}</td>
          </tr>
        `,
          )
          .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.invoiceNumber} - ${docTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #e5e5e5; color: #000; padding: 20px; font-size: 11px; }
    .page { max-width: 800px; margin: 0 auto; background: #fff; border: 1.5px solid #000; padding: 18px; }
    .header-row { display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #000; padding-bottom: 10px; margin-bottom: 10px; }
    .brand-wrap { display: flex; align-items: center; gap: 8px; }
    .brand-img { width: 28px; height: 28px; object-fit: contain; }
    .logo-text { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; color: #000000; }
    .doc-title { font-size: 22px; font-weight: 900; }
    .split-box { display: flex; border: 1.5px solid #000; margin-bottom: -1.5px; }
    .split-left { flex: 1.35; padding: 10px 12px; border-right: 1.5px solid #000; }
    .split-right { flex: 1; padding: 10px 12px; }
    .box-title { font-size: 11px; font-weight: bold; margin-bottom: 4px; text-transform: uppercase; color: #000; }
    .lead-name { font-size: 12px; font-weight: bold; margin-bottom: 3px; }
    .meta-line { display: flex; font-size: 10.5px; margin-top: 2px; }
    .meta-label { width: 130px; font-weight: bold; color: #333; }
    .meta-val { flex: 1; color: #000; }
    table { width: 100%; border-collapse: collapse; border: 1.5px solid #000; margin-top: 10px; font-size: 10.5px; }
    th { border: 1px solid #000; padding: 6px 4px; font-size: 9.5px; font-weight: bold; background: #fff; text-align: left; }
    td { border: 1px solid #000; padding: 6px 4px; vertical-align: top; }
    .words-box { border: 1.5px solid #000; border-top: none; padding: 8px 10px; font-size: 11px; }
    .sign-box { display: flex; border: 1.5px solid #000; border-top: none; padding: 10px 12px; justify-content: space-between; align-items: center; }
    .terms-box { border: 1.5px solid #000; border-top: none; padding: 8px 10px; font-size: 9.5px; line-height: 1.45; color: #111; }
    .terms-box ol { padding-left: 14px; margin-top: 4px; }
    .print-btn-bar { max-width: 800px; margin: 0 auto 12px auto; display: flex; justify-content: flex-end; }
    .btn-print { background: #000; color: #fff; border: none; font-weight: bold; font-size: 12px; padding: 8px 16px; cursor: pointer; border-radius: 4px; }
    @media print {
      body { background: #fff; padding: 0; }
      .print-btn-bar { display: none !important; }
      .page { border: none; padding: 0; width: 100%; max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="print-btn-bar">
    <button class="btn-download" onclick="downloadPdfDirectly()">📥 Download PDF</button>
    <button class="btn-print" onclick="window.print()">🖨️ Print / Save</button>
  </div>

  <div class="page">
    <!-- Top Header: Logo + Document Title -->
    <div class="header-row">
      <div class="brand-wrap">
        ${getLogoDataUri() ? `<img src="${getLogoDataUri()}" class="brand-img" alt="ExtraHand Logo" />` : ''}
        <div class="logo-text">extrahand</div>
      </div>
      <div class="doc-title">${docTitle}</div>
    </div>

    <!-- Box 1: Sold By / Seller (Left) + Invoice Metadata (Right) -->
    <div class="split-box">
      <div class="split-left">
        <div class="box-title">Sold By / Seller</div>
        <div class="lead-name">${data.seller.legalName || data.seller.tradeName}</div>
        <div style="font-size: 10.5px; color: #222; margin-bottom: 4px;">${data.seller.address}</div>
        <div class="meta-line">
          <span class="meta-label">GSTIN</span>
          <span class="meta-val">: ${data.seller.gstin}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label">FSSAI License Number</span>
          <span class="meta-val">: ${data.seller.fssaiNumber}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label">PAN</span>
          <span class="meta-val">: ${data.seller.pan || 'Not Applicable'}</span>
        </div>
      </div>
      <div class="split-right" style="display: flex; flex-direction: column; justify-content: center;">
        <div class="box-title">Invoice Details</div>
        <div class="meta-line">
          <span class="meta-label" style="width: 100px;">Invoice Number</span>
          <span class="meta-val">: <strong style="font-family: monospace; font-size: 11px;">${data.invoiceNumber}</strong></span>
        </div>
        <div class="meta-line">
          <span class="meta-label" style="width: 100px;">Invoice Date</span>
          <span class="meta-val">: ${data.invoiceDate}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label" style="width: 100px;">Order ID</span>
          <span class="meta-val">: ${data.orderNumber}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label" style="width: 100px;">Payment Status</span>
          <span class="meta-val" style="color: #0c831f; font-weight: bold;">: ${data.paymentStatus || 'Paid'}</span>
        </div>
      </div>
    </div>

    <!-- Box 2: Invoice To (Left) + Supply Info (Right) -->
    <div class="split-box">
      <div class="split-left">
        <div class="box-title">Invoice To</div>
        <div class="meta-line">
          <span class="meta-label" style="width: 70px;">Name</span>
          <span class="meta-val">: ${data.customer.name}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label" style="width: 70px;">Address</span>
          <span class="meta-val">: ${data.customer.billingAddress || data.customer.address}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label" style="width: 70px;">State</span>
          <span class="meta-val">: ${data.customer.state || 'Telangana'}</span>
        </div>
      </div>
      <div class="split-right" style="display: flex; flex-direction: column; justify-content: center;">
        <div class="meta-line">
          <span class="meta-label" style="width: 110px;">Payment Mode</span>
          <span class="meta-val">: ${data.paymentMode}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label" style="width: 110px;">Place of Supply</span>
          <span class="meta-val">: ${data.placeOfSupply || 'Telangana'}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label" style="width: 110px;">Txn Reference</span>
          <span class="meta-val">: ${data.transactionReference}</span>
        </div>
      </div>
    </div>

    <!-- Items Table (Product Items Only) -->
    <table>
      <thead>
        ${
          isTax
            ? `
          <tr>
            <th style="width: 25px; text-align: center;">Sr. no</th>
            <th style="width: 50px; text-align: center;">UPC</th>
            <th>Item Description</th>
            <th style="text-align: right; width: 45px;">MRP</th>
            <th style="text-align: right; width: 45px;">Discount</th>
            <th style="text-align: center; width: 35px;">Qty.</th>
            <th style="text-align: right; width: 65px;">Taxable Value</th>
            <th style="text-align: right; width: 45px;">CGST (%)</th>
            <th style="text-align: right; width: 55px;">CGST (INR)</th>
            <th style="text-align: right; width: 45px;">SGST (%)</th>
            <th style="text-align: right; width: 55px;">SGST (INR)</th>
            <th style="text-align: right; width: 40px;">Cess (%)</th>
            <th style="text-align: right; width: 60px;">Addl Cess</th>
            <th style="text-align: right; width: 65px;">Total</th>
          </tr>
        `
            : `
          <tr>
            <th style="width: 35px; text-align: center;">Sr. no</th>
            <th>Item Description</th>
            <th style="text-align: center; width: 60px;">Qty.</th>
            <th style="text-align: right; width: 100px;">Unit Price (₹)</th>
            <th style="text-align: right; width: 110px;">Total (₹)</th>
          </tr>
        `
        }
      </thead>
      <tbody>
        ${itemRows}
        <!-- Total Row -->
        <tr style="font-weight: bold; background: #fafafa;">
          <td colspan="${isTax ? 5 : 2}" style="text-align: right;">Product Total</td>
          <td style="text-align: center;">${totalQty}</td>
          ${
            isTax
              ? `
            <td style="text-align: right;">${formatRupees(data.totals.totalTaxablePaise)}</td>
            <td></td>
            <td style="text-align: right;">${formatRupees(data.totals.cgstTotalPaise)}</td>
            <td></td>
            <td style="text-align: right;">${formatRupees(data.totals.sgstTotalPaise)}</td>
            <td></td>
            <td></td>
          `
              : ''
          }
          <td style="text-align: right; font-weight: 900;">${formatRupees(data.totals.grandTotalPaise)}</td>
        </tr>
      </tbody>
    </table>

    <!-- Amount in Words -->
    <div class="words-box">
      <strong>Amount in Words:</strong> ${data.totals.amountInWords}
    </div>

    <!-- Seller Authorized Signatory Box -->
    <div class="sign-box">
      <div>
        <div style="font-weight: bold; font-size: 11px;">${data.seller.legalName || data.seller.tradeName}</div>
        <div style="display: flex; gap: 16px; margin-top: 4px; font-size: 10px; color: #333;">
          <span>GSTIN: ${data.seller.gstin}</span>
          <span>FSSAI License: ${data.seller.fssaiNumber}</span>
          <span>PAN: ${data.seller.pan || 'Not Applicable'}</span>
        </div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 9.5px; color: #666; font-style: italic;">Computer generated document</div>
        <div style="font-size: 10px; font-weight: bold; margin-top: 3px;">Authorized Signatory</div>
      </div>
    </div>

    <!-- Reverse Charge -->
    <div style="border: 1.5px solid #000; border-top: none; padding: 6px 10px; font-weight: bold; font-size: 10.5px;">
      ${isTax ? 'Whether the tax is payable on reverse charge: No' : 'Whether the tax is payable on reverse charge: No (Unregistered Supplier)'}
    </div>

    <!-- Terms & Conditions -->
    <div class="terms-box">
      <strong>Terms & Conditions:</strong>
      <ol>
        <li>If you have any issues or queries in respect of your order, please contact customer chat support through ExtraHand platform or drop an email at support@extrahand.in.</li>
        <li>In case you need to get more information about seller's FSSAI status, please visit https://foscos.fssai.gov.in/ and use the FBO search option with FSSAI License / Registration number.</li>
        <li>Please note that we never ask for bank account details such as CVV, account number, UPI Pin, etc. across our support channels. For your safety please do not share these details with anyone over any medium.</li>
        <li>MRP displayed on the platform is as printed on the product package. Actual MRP and amount payable may be a function of offers/discounts and/or revised rates.</li>
        <li>Logistics and delivery services, if any, are billed separately under delivery partner tax invoice.</li>
      </ol>
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <script>
    function downloadPdfDirectly() {
      var btn = document.querySelector('.btn-download');
      if (btn) btn.innerText = '⏳ Generating PDF...';
      var element = document.querySelector('.page') || document.querySelector('.container');
      var opt = {
        margin: [6, 6, 6, 6],
        filename: '${data.invoiceNumber || "Order-Invoice"}.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      if (window.html2pdf) {
        window.html2pdf().set(opt).from(element).save().then(function() {
          if (btn) btn.innerText = '✅ Downloaded!';
          setTimeout(function() { if (btn) btn.innerText = '📥 Download PDF'; }, 3000);
        }).catch(function(err) {
          console.error(err);
          if (btn) btn.innerText = '📥 Download PDF';
          window.print();
        });
      } else {
        window.print();
      }
    }

    window.addEventListener('load', function() {
      var params = new URLSearchParams(window.location.search);
      if (params.get('auto') === 'download') {
        setTimeout(downloadPdfDirectly, 600);
      } else if (params.get('auto') === 'print') {
        setTimeout(function() { window.print(); }, 400);
      }
    });
  </script>

</body>
</html>`;
  }

  static async getCommissionInvoiceData(sellerId: string, payoutIdOrPeriod?: string) {
    const onboarding = await SellerOnboarding.findOne({
      sellerId: new mongoose.Types.ObjectId(sellerId),
    }).lean();

    // Check for PAN and FSSAI from onboarding or uploaded documents
    let sellerPan: string | undefined = onboarding?.pan?.trim();
    let sellerFssai: string | undefined = onboarding?.fssaiNumber?.trim();

    if (!sellerPan || !sellerFssai) {
      const docs = await SellerDocument.find({
        sellerId: new mongoose.Types.ObjectId(sellerId),
        documentType: { $in: ['PAN_CARD', 'FSSAI_CERTIFICATE'] },
      }).lean();

      for (const doc of docs) {
        if (!sellerPan && doc.documentType === 'PAN_CARD' && doc.documentNumber?.trim()) {
          sellerPan = doc.documentNumber.trim();
        }
        if (!sellerFssai && doc.documentType === 'FSSAI_CERTIFICATE' && doc.documentNumber?.trim()) {
          sellerFssai = doc.documentNumber.trim();
        }
      }
    }

    if (!sellerPan && onboarding?.gstin && onboarding.gstin.trim().length === 15) {
      sellerPan = onboarding.gstin.trim().slice(2, 12);
    }

    const sellerLegalName = onboarding?.gstinVerifiedLegalName || onboarding?.shopName || 'Registered Seller';
    const sellerTradeName = onboarding?.gstinVerifiedTradeName || onboarding?.shopName || 'ExtraHand Partner Store';
    const sellerAddress = onboarding?.formattedAddress || onboarding?.address || 'Hyderabad, Telangana';

    // Find ledgers for this payout or period
    let ledgerQuery: Record<string, any> = { sellerId: new mongoose.Types.ObjectId(sellerId) };
    if (payoutIdOrPeriod && payoutIdOrPeriod !== 'latest') {
      ledgerQuery.payoutId = payoutIdOrPeriod;
    }

    const ledgers = await SellerLedger.find(ledgerQuery).sort({ createdAt: -1 }).limit(50).lean();

    let totalGrossPaise = 0;
    let totalCommissionPaise = 0;
    let totalTaxOnCommissionPaise = 0;

    for (const l of ledgers) {
      totalGrossPaise += l.grossAmountPaise || 0;
      totalCommissionPaise += l.commissionAmountPaise || 0;
      totalTaxOnCommissionPaise += l.taxOnCommissionPaise || 0;
    }

    // Default sample values if no ledgers yet
    if (totalCommissionPaise === 0) {
      totalGrossPaise = 5000;
      totalCommissionPaise = 175;
      totalTaxOnCommissionPaise = 32;
    }

    const totalInvoicePaise = totalCommissionPaise + totalTaxOnCommissionPaise;
    const cgstPaise = Math.round(totalTaxOnCommissionPaise / 2);
    const sgstPaise = totalTaxOnCommissionPaise - cgstPaise;

    const invoiceNumber = `EH-COMM-${new Date().getFullYear()}-${payoutIdOrPeriod || '001'}`;

    return {
      invoiceNumber,
      invoiceDate: new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
      supplier: {
        legalName: 'NAIPUNYA AI LABS PRIVATE LIMITED',
        tradeName: 'ExtraHand (Naipunya AI Labs Private Limited)',
        gstin: '36AAKCN0492J1Z5',
        address: 'Hitech City, Madhapur, Hyderabad, Telangana - 500081',
        sacCode: '998313',
        serviceDescription: 'Online Marketplace Platform & Facilitation Services',
      },
      recipient: {
        legalName: sellerLegalName,
        tradeName: sellerTradeName,
        address: sellerAddress,
        gstin: onboarding?.gstin || 'Unregistered',
      },
      feeBreakdown: {
        totalGrossOrdersPaise: totalGrossPaise,
        platformFeePaise: totalCommissionPaise,
        cgstPaise,
        sgstPaise,
        totalGstPaise: totalTaxOnCommissionPaise,
        totalInvoiceAmountPaise: totalInvoicePaise,
        amountInWords: numberToWords(totalInvoicePaise / 100),
      },
    };
  }

  /**
   * Returns standalone HTML for ExtraHand Commission Invoice
   */
  static renderCommissionInvoiceHtml(data: any): string {
    const qrSvg = `<svg width="90" height="90" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="white"/>
      <path d="M10 10h30v30H10V10zm6 6v18h18V16H16zm4 4h10v10H20V20zm40-10h30v30H60V10zm6 6v18h18V16H66zm4 4h10v10H70V20zM10 60h30v30H10V60zm6 6v18h18V66H16zm4 4h10v10H20V70zm40 0h10v10H60V70zm10-10h10v10H70V60zm10 10h10v10H80V70zm0 10h10v10H80V80zm-20 0h10v10H60V80zm20-20h10v10H80V60zM45 15h10v10H45V15zm0 20h10v10H45V35zm0 20h10v10H45V55zm0 20h10v10H45V75z" fill="#000000"/>
    </svg>`;

    const signatureSvg = `<svg width="120" height="40" viewBox="0 0 140 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 32C30 15 45 5 55 18C62 27 68 35 75 22C80 12 95 8 105 25C110 32 120 18 135 15" stroke="#1e3a8a" stroke-width="2" stroke-linecap="round"/>
    </svg>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.invoiceNumber} - ExtraHand Platform Commission Invoice</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #e5e5e5; color: #000; padding: 20px; font-size: 11px; }
    .page { max-width: 800px; margin: 0 auto; background: #fff; border: 1.5px solid #000; padding: 18px; }
    .header-row { display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #000; padding-bottom: 10px; margin-bottom: 10px; }
    .brand-wrap { display: flex; align-items: center; gap: 8px; }
    .brand-img { width: 28px; height: 28px; object-fit: contain; }
    .logo-text { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; color: #000000; }
    .doc-title { font-size: 22px; font-weight: 900; }
    .split-box { display: flex; border: 1.5px solid #000; margin-bottom: -1.5px; }
    .split-left { flex: 1.35; padding: 8px 10px; border-right: 1.5px solid #000; }
    .split-right { flex: 1; padding: 8px 10px; }
    .box-title { font-size: 11px; font-weight: bold; margin-bottom: 4px; }
    .lead-name { font-size: 12px; font-weight: bold; margin-bottom: 2px; }
    .meta-line { display: flex; font-size: 10.5px; margin-top: 2px; }
    .meta-label { width: 130px; font-weight: bold; }
    .meta-val { flex: 1; }
    table { width: 100%; border-collapse: collapse; border: 1.5px solid #000; margin-top: 10px; font-size: 10.5px; }
    th { border: 1px solid #000; padding: 6px 4px; font-size: 9.5px; font-weight: bold; background: #fff; text-align: left; }
    td { border: 1px solid #000; padding: 6px 4px; vertical-align: top; }
    .words-box { border: 1.5px solid #000; border-top: none; padding: 8px 10px; font-size: 11px; }
    .sign-box { display: flex; border: 1.5px solid #000; border-top: none; padding: 8px 10px; justify-content: space-between; align-items: center; }
    .terms-box { border: 1.5px solid #000; border-top: none; padding: 8px 10px; font-size: 9.5px; line-height: 1.45; color: #111; }
    .print-btn-bar { max-width: 800px; margin: 0 auto 12px auto; display: flex; justify-content: flex-end; }
    .btn-print { background: #000; color: #fff; border: none; font-weight: bold; font-size: 12px; padding: 8px 16px; cursor: pointer; border-radius: 4px; }
    @media print {
      body { background: #fff; padding: 0; }
      .print-btn-bar { display: none !important; }
      .page { border: none; padding: 0; width: 100%; max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="print-btn-bar">
    <button class="btn-print" onclick="window.print()">🖨️ Print / Download PDF</button>
  </div>

  <div class="page">
    <div class="header-row">
      <div class="brand-wrap">
        ${getLogoDataUri() ? `<img src="${getLogoDataUri()}" class="brand-img" alt="ExtraHand Logo" />` : ''}
        <div class="logo-text">extrahand</div>
      </div>
      <div class="doc-title">Tax Invoice</div>
    </div>

    <!-- Box 1: Service Provider (NAIPUNYA AI LABS) -->
    <div class="split-box">
      <div class="split-left">
        <div class="box-title">Sold By / Service Provider</div>
        <div class="lead-name">${data.supplier.legalName}</div>
        <div style="font-size: 10.5px; color: #222; margin-bottom: 4px;">${data.supplier.address}</div>
        <div class="meta-line">
          <span class="meta-label">GSTIN</span>
          <span class="meta-val">: ${data.supplier.gstin}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label">CIN</span>
          <span class="meta-val">: U72900TG2026PTC184920</span>
        </div>
        <div class="meta-line">
          <span class="meta-label">PAN</span>
          <span class="meta-val">: AAKCN0492J</span>
        </div>
      </div>
      <div class="split-right" style="display: flex; flex-direction: column; justify-content: center; padding: 10px 12px;">
        <div style="font-size: 10px; font-weight: bold; color: #555;">Invoice Number :</div>
        <div style="font-size: 12px; font-weight: bold; font-family: monospace; color: #000; margin-top: 2px;">${data.invoiceNumber}</div>
        <div style="margin-top: 8px; font-size: 10px; font-weight: bold; color: #0c831f;">Invoice Status : SETTLED</div>
      </div>
    </div>

    <!-- Box 2: Billed To (Seller) -->
    <div class="split-box">
      <div class="split-left">
        <div class="box-title">Invoice To (Merchant / Seller)</div>
        <div class="meta-line">
          <span class="meta-label" style="width: 70px;">Name</span>
          <span class="meta-val">: ${data.recipient.tradeName}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label" style="width: 70px;">Address</span>
          <span class="meta-val">: ${data.recipient.address}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label" style="width: 70px;">GSTIN</span>
          <span class="meta-val">: ${data.recipient.gstin || 'Unregistered'}</span>
        </div>
      </div>
      <div class="split-right">
        <div class="meta-line">
          <span class="meta-label" style="width: 110px;">Service Category</span>
          <span class="meta-val">: Online Marketplace Services</span>
        </div>
        <div class="meta-line">
          <span class="meta-label" style="width: 110px;">Invoice Date</span>
          <span class="meta-val">: ${data.invoiceDate}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label" style="width: 110px;">Place of Supply</span>
          <span class="meta-val">: Telangana (36)</span>
        </div>
      </div>
    </div>

    <!-- Services Table -->
    <table>
      <thead>
        <tr>
          <th style="width: 30px; text-align: center;">Sr. no</th>
          <th style="width: 70px; text-align: center;">SAC</th>
          <th>Service Description</th>
          <th style="text-align: right; width: 100px;">Taxable Value (₹)</th>
          <th style="text-align: right; width: 65px;">CGST (9%)</th>
          <th style="text-align: right; width: 65px;">SGST (9%)</th>
          <th style="text-align: right; width: 90px;">Total Fee (₹)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="text-align: center;">1</td>
          <td style="text-align: center; font-family: monospace;">${data.supplier.sacCode}</td>
          <td>
            <strong>Marketplace Facilitation & Platform Commission Fee</strong><br>
            <span style="font-size: 10px; color: #555;">Commission on completed order sales (Eligible for ITC under GST)</span>
          </td>
          <td style="text-align: right;">${formatRupees(data.feeBreakdown.platformFeePaise)}</td>
          <td style="text-align: right;">${formatRupees(data.feeBreakdown.cgstPaise)}</td>
          <td style="text-align: right;">${formatRupees(data.feeBreakdown.sgstPaise)}</td>
          <td style="text-align: right; font-weight: bold;">${formatRupees(data.feeBreakdown.totalInvoiceAmountPaise)}</td>
        </tr>
        <tr style="font-weight: bold; background: #fafafa;">
          <td colspan="3" style="text-align: right;">Total</td>
          <td style="text-align: right;">${formatRupees(data.feeBreakdown.platformFeePaise)}</td>
          <td style="text-align: right;">${formatRupees(data.feeBreakdown.cgstPaise)}</td>
          <td style="text-align: right;">${formatRupees(data.feeBreakdown.sgstPaise)}</td>
          <td style="text-align: right; font-weight: 900;">${formatRupees(data.feeBreakdown.totalInvoiceAmountPaise)}</td>
        </tr>
      </tbody>
    </table>

    <div class="words-box">
      <strong>Amount in Words:</strong> ${data.feeBreakdown.amountInWords}
    </div>

    <!-- Authorized Signatory -->
    <div class="sign-box">
      <div>
        <div style="font-weight: bold; font-size: 11px;">For ${data.supplier.legalName}</div>
        <div style="font-size: 10px; color: #333; margin-top: 4px;">GSTIN: ${data.supplier.gstin} | PAN: AAKCN0492J</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 9.5px; color: #666; font-style: italic;">Computer generated document</div>
        <div style="font-size: 10px; font-weight: bold; margin-top: 3px;">Authorized Signatory</div>
      </div>
    </div>

    <div style="border: 1.5px solid #000; border-top: none; padding: 6px 10px; font-weight: bold; font-size: 10.5px;">
      Whether the tax is payable on reverse charge: No
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <script>
    function downloadPdfDirectly() {
      var btn = document.querySelector('.btn-download');
      if (btn) btn.innerText = '⏳ Generating PDF...';
      var element = document.querySelector('.page') || document.querySelector('.container');
      var opt = {
        margin: [6, 6, 6, 6],
        filename: '${data.invoiceNumber || "Commission-Invoice"}.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      if (window.html2pdf) {
        window.html2pdf().set(opt).from(element).save().then(function() {
          if (btn) btn.innerText = '✅ Downloaded!';
          setTimeout(function() { if (btn) btn.innerText = '📥 Download PDF'; }, 3000);
        }).catch(function(err) {
          console.error(err);
          if (btn) btn.innerText = '📥 Download PDF';
          window.print();
        });
      } else {
        window.print();
      }
    }

    window.addEventListener('load', function() {
      var params = new URLSearchParams(window.location.search);
      if (params.get('auto') === 'download') {
        setTimeout(downloadPdfDirectly, 600);
      } else if (params.get('auto') === 'print') {
        setTimeout(function() { window.print(); }, 400);
      }
    });
  </script>

</body>
</html>`;
  }

  static async getSettlementStatementData(sellerId: string, payoutId: string) {
    const onboarding = await SellerOnboarding.findOne({
      sellerId: new mongoose.Types.ObjectId(sellerId),
    }).lean();

    // Check for PAN and FSSAI from onboarding or uploaded documents
    let sellerPan: string | undefined = onboarding?.pan?.trim();
    let sellerFssai: string | undefined = onboarding?.fssaiNumber?.trim();

    if (!sellerPan || !sellerFssai) {
      const docs = await SellerDocument.find({
        sellerId: new mongoose.Types.ObjectId(sellerId),
        documentType: { $in: ['PAN_CARD', 'FSSAI_CERTIFICATE'] },
      }).lean();

      for (const doc of docs) {
        if (!sellerPan && doc.documentType === 'PAN_CARD' && doc.documentNumber?.trim()) {
          sellerPan = doc.documentNumber.trim();
        }
        if (!sellerFssai && doc.documentType === 'FSSAI_CERTIFICATE' && doc.documentNumber?.trim()) {
          sellerFssai = doc.documentNumber.trim();
        }
      }
    }

    if (!sellerPan && onboarding?.gstin && onboarding.gstin.trim().length === 15) {
      sellerPan = onboarding.gstin.trim().slice(2, 12);
    }

    const payout = await SellerPayout.findOne({
      sellerId: new mongoose.Types.ObjectId(sellerId),
      payoutId,
    }).lean();

    const ledgers = await SellerLedger.find({
      sellerId: new mongoose.Types.ObjectId(sellerId),
      payoutId,
    }).lean();

    const bankAccount = payout?.bankAccount || {
      accountHolderName: onboarding?.shopName || 'Merchant',
      accountNumberMasked: '•••• •••• 9812',
      ifscCode: 'HDFC0001234',
    };

    let totalGrossPaise = 0;
    let totalPlatformFeePaise = 0;
    let totalGstPaise = 0;
    let totalNetPaise = payout?.amountPaise || 0;

    const orders = ledgers.map((l) => {
      totalGrossPaise += l.grossAmountPaise || 0;
      totalPlatformFeePaise += l.commissionAmountPaise || 0;
      totalGstPaise += l.taxOnCommissionPaise || 0;
      if (!payout) totalNetPaise += l.netAmountPaise || 0;

      return {
        orderNumber: l.orderNumber || 'QC-ORDER',
        orderDate: l.createdAt ? new Date(l.createdAt).toLocaleDateString('en-IN') : 'Today',
        grossPaise: l.grossAmountPaise || 0,
        feePaise: l.commissionAmountPaise || 0,
        gstPaise: l.taxOnCommissionPaise || 0,
        netPaise: l.netAmountPaise || 0,
        status: l.status,
      };
    });

    return {
      statementNumber: `STMT-${payoutId}`,
      statementDate: payout?.settledAt
        ? new Date(payout.settledAt).toLocaleDateString('en-IN')
        : new Date().toLocaleDateString('en-IN'),
      payoutId,
      referenceNumber: payout?.referenceNumber || payout?.gatewayPayoutId || 'NEFT-PROCESSING',
      seller: {
        storeName: onboarding?.shopName || 'Merchant Store',
        address: onboarding?.formattedAddress || onboarding?.address || 'Hyderabad, Telangana',
      },
      bankAccount,
      summary: {
        totalGrossPaise: totalGrossPaise || totalNetPaise,
        totalPlatformFeePaise,
        totalGstPaise,
        totalNetPaise,
        orderCount: orders.length,
      },
      orders,
    };
  }

  /**
   * Returns standalone HTML for Settlement Statement
   */
  static renderSettlementStatementHtml(data: any): string {
    const orderRows = data.orders
      .map(
        (o: any, idx: number) => `
      <tr style="border-bottom: 1px solid #e2e8f0; font-size: 12px;">
        <td style="padding: 8px;">${idx + 1}</td>
        <td style="padding: 8px; font-family: monospace; font-weight: bold;">${o.orderNumber}</td>
        <td style="padding: 8px;">${o.orderDate}</td>
        <td style="padding: 8px; text-align: right;">${formatRupees(o.grossPaise)}</td>
        <td style="padding: 8px; text-align: right; color: #dc2626;">-${formatRupees(o.feePaise)}</td>
        <td style="padding: 8px; text-align: right; color: #dc2626;">-${formatRupees(o.gstPaise)}</td>
        <td style="padding: 8px; text-align: right; font-weight: bold; color: #059669;">${formatRupees(o.netPaise)}</td>
      </tr>
    `,
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${data.statementNumber} - ExtraHand Settlement Statement</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 24px; }
    .container { max-width: 820px; margin: 0 auto; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; }
    .title { font-size: 22px; font-weight: 900; color: #0f172a; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 24px; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { background: #0f172a; color: white; padding: 8px; font-size: 11px; text-transform: uppercase; }
    .payout-card { background: #e0f2fe; border: 1px solid #7dd3fc; border-radius: 8px; padding: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
    @media print {
      body { background: white; padding: 0; }
      .container { border: none; box-shadow: none; padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="print-btn-bar">
    <button class="btn-download" onclick="downloadPdfDirectly()">📥 Download PDF</button>
    <button class="btn-print" onclick="window.print()">🖨️ Print / Save</button>
  </div>
  <div class="container">
    <div class="header">
      <div>
        <div style="background: #0284c7; color: white; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-bottom: 4px;">SETTLEMENT ADVICE</div>
        <div class="title">Payout Settlement Statement</div>
        <div style="font-size: 12px; color: #64748b;">Bank Reference (UTR): <strong>${data.referenceNumber}</strong></div>
      </div>
      <div style="text-align: right; font-size: 12px;">
        <div style="font-size: 16px; font-weight: 800; font-family: monospace;">${data.statementNumber}</div>
        <div style="color: #64748b; margin-top: 4px;">Date: <strong>${data.statementDate}</strong></div>
      </div>
    </div>

    <div class="payout-card">
      <div>
        <div style="font-size: 11px; font-weight: 700; color: #0369a1; text-transform: uppercase;">Credited to Bank Account</div>
        <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 2px;">${data.bankAccount.accountNumberMasked} (${data.bankAccount.ifscCode})</div>
        <div style="font-size: 12px; color: #334155;">Holder: ${data.bankAccount.accountHolderName}</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 11px; font-weight: 700; color: #0369a1; text-transform: uppercase;">Net Amount Credited</div>
        <div style="font-size: 24px; font-weight: 900; color: #0284c7;">${formatRupees(data.summary.totalNetPaise)}</div>
      </div>
    </div>

    <div class="grid">
      <div>
        <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8;">Merchant Details</div>
        <p style="font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 2px;">${data.seller.storeName}</p>
        <p>${data.seller.address}</p>
      </div>
      <div>
        <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8;">Settlement Summary</div>
        <div style="display: flex; justify-content: space-between; margin-top: 4px;"><span>Total Orders:</span><strong>${data.summary.orderCount}</strong></div>
        <div style="display: flex; justify-content: space-between;"><span>Gross Sales:</span><span>${formatRupees(data.summary.totalGrossPaise)}</span></div>
        <div style="display: flex; justify-content: space-between; color: #dc2626;"><span>Platform Fee & Tax:</span><span>-${formatRupees(data.summary.totalPlatformFeePaise + data.summary.totalGstPaise)}</span></div>
      </div>
    </div>

    ${
      data.orders.length > 0
        ? `
      <table>
        <thead>
          <tr>
            <th style="width: 30px; text-align: center;">#</th>
            <th style="text-align: left;">Order ID</th>
            <th style="text-align: left;">Date</th>
            <th style="text-align: right;">Gross (₹)</th>
            <th style="text-align: right;">Fee (₹)</th>
            <th style="text-align: right;">GST (₹)</th>
            <th style="text-align: right;">Net (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${orderRows}
        </tbody>
      </table>
    `
        : ''
    }

    <div style="border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 11px; color: #64748b; display: flex; justify-content: space-between;">
      <div>This is an electronic settlement summary for merchant accounting reconciliation.</div>
      <div>NAIPUNYA AI LABS PRIVATE LIMITED</div>
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <script>
    function downloadPdfDirectly() {
      var btn = document.querySelector('.btn-download');
      if (btn) btn.innerText = '⏳ Generating PDF...';
      var element = document.querySelector('.page') || document.querySelector('.container');
      var opt = {
        margin: [6, 6, 6, 6],
        filename: '${data.statementNumber || "Settlement-Statement"}.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      if (window.html2pdf) {
        window.html2pdf().set(opt).from(element).save().then(function() {
          if (btn) btn.innerText = '✅ Downloaded!';
          setTimeout(function() { if (btn) btn.innerText = '📥 Download PDF'; }, 3000);
        }).catch(function(err) {
          console.error(err);
          if (btn) btn.innerText = '📥 Download PDF';
          window.print();
        });
      } else {
        window.print();
      }
    }

    window.addEventListener('load', function() {
      var params = new URLSearchParams(window.location.search);
      if (params.get('auto') === 'download') {
        setTimeout(downloadPdfDirectly, 600);
      } else if (params.get('auto') === 'print') {
        setTimeout(function() { window.print(); }, 400);
      }
    });
  </script>

</body>
</html>`;
  }
}

import ExcelJS from 'exceljs';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import Attribute from '../models/Attribute';
import MasterProduct from '../models/MasterProduct';
import ProductImage from '../models/ProductImage';
import { generateMasterProductSku } from '../utils/sku';
import { uniqueSlug } from '../utils/slug';
import { normalizeProductInformation } from '../utils/productInformation';
import { ProductAttributeValue } from '../types';

export interface BulkUploadRowError {
  rowNumber: number;
  productName: string;
  reasons: string[];
}

export interface BulkUploadResult {
  totalRows: number;
  insertedCount: number;
  failedCount: number;
  errors: BulkUploadRowError[];
}

export class MasterProductBulkService {
  /**
   * Generates a pre-filled Excel template populated with active categories,
   * subcategories, product types, standard units, clinical medical options,
   * and 5 realistic sample products (2 Kirana + 3 Medical).
   */
  static async generateTemplate(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ExtraHand Platform';
    workbook.lastModifiedBy = 'ExtraHand Platform';
    workbook.created = new Date();
    workbook.modified = new Date();

    // 1. Fetch Taxonomies from Database
    const [categories, subcategories, productTypes, attributes] = await Promise.all([
      Category.find({ status: { $ne: 'INACTIVE' } }).sort({ name: 1 }).lean(),
      Subcategory.find({ status: { $ne: 'INACTIVE' } }).sort({ name: 1 }).lean(),
      ProductType.find({ status: { $ne: 'INACTIVE' } }).sort({ name: 1 }).lean(),
      Attribute.find({ status: { $ne: 'INACTIVE' } }).lean(),
    ]);

    const categoryNames = categories.map((c) => c.name);
    const subcategoryNames = subcategories.map((s) => s.name);
    const productTypeNames = productTypes.map((pt) => pt.name);

    const standardUnits = [
      'kg', 'g', 'L', 'ml', 'pcs', 'Pack', 'piece', 'packet',
      'box', 'bottle', 'can', 'jar', 'pouch', 'strip', 'tablet', 'tray'
    ];
    const verticals = ['KIRANA', 'MEDICAL', 'SEASONAL'];
    const foodTypes = ['Vegetarian', 'Non-Vegetarian', 'Egg', 'N/A'];
    const lifespanUnits = ['Days', 'Weeks', 'Months', 'Years'];
    const yesNo = ['YES', 'NO'];

    // Medical dropdown taxonomies
    const dosageForms = [
      'Tablet', 'Capsule', 'Syrup', 'Ointment', 'Injection', 'Drops',
      'Gel', 'Inhaler', 'Lotion', 'Powder', 'Cream', 'Suspension', 'Solution', 'Other'
    ];
    const routesOfAdmin = [
      'Oral', 'Topical', 'Inhalation', 'Ophthalmic (Eye)', 'Otic (Ear)',
      'Nasal', 'Intravenous', 'Intramuscular', 'Subcutaneous', 'Rectal', 'Other'
    ];
    const prescriptionCategories = [
      'Schedule H', 'Schedule H1', 'Schedule X', 'Schedule G',
      'OTC / Non-Prescription', 'General Sale'
    ];

    // Atta, Milk & Packaging options
    const attaAttr = attributes.find((a) => a.key === 'atta_type');
    const attaOptions = (attaAttr?.options && attaAttr.options.length > 0)
      ? attaAttr.options.map((o: any) => (typeof o === 'string' ? o : o.value))
      : ['Whole Wheat', 'Multigrain', 'Refined', 'Sharbati'];

    const milkAttr = attributes.find((a) => a.key === 'milk_type');
    const milkOptions = (milkAttr?.options && milkAttr.options.length > 0)
      ? milkAttr.options.map((o: any) => (typeof o === 'string' ? o : o.value))
      : ['Cow', 'Buffalo', 'Toned', 'Full Cream', 'Double Toned', 'UHT'];

    const pkgAttr = attributes.find((a) => a.key === 'packaging_type');
    const pkgOptions = (pkgAttr?.options && pkgAttr.options.length > 0)
      ? pkgAttr.options.map((o: any) => (typeof o === 'string' ? o : o.value))
      : ['Strip', 'Bottle', 'Box', 'Bag', 'Pouch', 'Jar', 'Tin', 'Tube', 'Vial', 'Tray'];

    // Styling Palette
    const THEME_HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
    const THEME_HEADER_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };

    const GROUP_MAPPING_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '3B82F6' } };
    const GROUP_CORE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F766E' } };
    const GROUP_PRICE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'B45309' } };
    const GROUP_COMPLIANCE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '475569' } };
    const GROUP_ATTR_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '6D28D9' } };
    const GROUP_MED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'BE123C' } };

    const GROUP_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
    const TECH_KEY_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 9, italic: true, color: { argb: '64748B' } };
    const TECH_KEY_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };

    // ========================================================
    // SHEET 1: Instructions
    // ========================================================
    const wsInst = workbook.addWorksheet('Instructions', {
      views: [{ showGridLines: true }],
    });
    wsInst.columns = [{ width: 5 }, { width: 32 }, { width: 95 }];

    wsInst.mergeCells('B2:C2');
    const titleCell = wsInst.getCell('B2');
    titleCell.value = 'ExtraHand - Master Catalogue Bulk Ingestion Template (Kirana & Medical)';
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: '0F172A' } };
    wsInst.getRow(2).height = 32;

    wsInst.mergeCells('B3:C3');
    const subCell = wsInst.getCell('B3');
    subCell.value = 'Guidelines & instructions for adding bulk products to the central Master Catalogue.';
    subCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: '475569' } };
    wsInst.getRow(3).height = 20;

    const instructions = [
      ['1. File Structure', 'Do NOT rename, delete, or change column headers in Row 2 of "Master_Products".'],
      ['2. Mandatory Core Fields (*)', 'Category, Subcategory, Product Type, Product Name, MRP, Selling Price, Net Quantity, and Unit are required for all products.'],
      ['3. Medical Products Rules', 'When Vertical is MEDICAL, clinical details must be entered: Generic Name, Dosage Form, Route of Administration, Strength, and Prescription status.'],
      ['4. Pricing in Rupees (₹)', 'Enter MRP and Selling Price in standard Rupees (e.g. 245.50). The backend will automatically convert them to Paise.'],
      ['5. Price Rule', 'Selling Price must always be less than or equal to MRP (Selling Price <= MRP).'],
      ['6. System SKU & Barcode', 'If System SKU is left empty, ExtraHand will automatically generate a clean, unique SKU. Barcode/EAN is optional.'],
      ['7. Dropdown Validations', 'Click the arrow in dropdown cells (Category, Unit, Veg/Non-Veg, Dosage Form, Route, etc.) to select valid values.'],
      ['8. Sample Data', 'Rows 4 to 8 contain 5 sample products (kirana 1, kirana 2, medical 1, medical 2, medical 3) illustrating how to fill each vertical.'],
    ];

    let startRow = 5;
    for (const [step, desc] of instructions) {
      const row = wsInst.getRow(startRow);
      row.getCell(2).value = step;
      row.getCell(2).font = { name: 'Calibri', size: 11, bold: true, color: { argb: '1E293B' } };
      row.getCell(3).value = desc;
      row.getCell(3).font = { name: 'Calibri', size: 11, color: { argb: '334155' } };
      row.height = 24;
      startRow++;
    }

    // ========================================================
    // SHEET 3: Valid_Values (Taxonomy Reference)
    // ========================================================
    const wsLookup = workbook.addWorksheet('Valid_Values', {
      views: [{ showGridLines: true }],
    });

    // Explicitly indexed lookup columns
    const lookupData: Record<string, string[]> = {
      Categories: categoryNames.length ? categoryNames : ['Grocery & Staples', 'Health & Wellness', 'Fresh & Daily Essentials'],
      Subcategories: subcategoryNames.length ? subcategoryNames : ['Atta, Rice, Oil & Dals', 'Dairy', 'Pharmacy & Wellness'],
      ProductTypes: productTypeNames.length ? productTypeNames : ['Atta & Flour', 'Milk', 'OTC Products', 'First Aid', 'Health Care Products'],
      Units: standardUnits,
      Verticals: verticals,
      FoodTypes: foodTypes,
      LifespanUnits: lifespanUnits,
      YesNo: yesNo,
      DosageForms: dosageForms,
      RoutesOfAdmin: routesOfAdmin,
      PrescriptionCategories: prescriptionCategories,
      PackagingTypes: pkgOptions,
      AttaTypes: attaOptions,
      MilkTypes: milkOptions,
    };

    const lookupKeys = Object.keys(lookupData);
    wsLookup.columns = lookupKeys.map((k) => ({ header: k, key: k, width: 24 }));

    const headerLookupRow = wsLookup.getRow(1);
    headerLookupRow.font = THEME_HEADER_FONT;
    headerLookupRow.fill = THEME_HEADER_FILL;
    headerLookupRow.height = 24;

    const maxLookupRows = Math.max(...Object.values(lookupData).map((arr) => arr.length));
    for (let r = 0; r < maxLookupRows; r++) {
      const rowVals: Record<string, string> = {};
      lookupKeys.forEach((k) => {
        rowVals[k] = lookupData[k][r] || '';
      });
      wsLookup.addRow(rowVals);
    }

    // ========================================================
    // SHEET 2: Master_Products (Data Ingestion Table - 36 Columns)
    // ========================================================
    const wsData = workbook.addWorksheet('Master_Products', {
      views: [{ showGridLines: true, state: 'frozen', ySplit: 3 }],
    });

    const columns = [
      // 1. Category Hierarchy (Cols 1-3: A-C)
      { header: 'Category *', techKey: 'categoryName', width: 24 },
      { header: 'Subcategory *', techKey: 'subcategoryName', width: 24 },
      { header: 'Product Type *', techKey: 'productTypeName', width: 22 },
      // 2. Product Core (Cols 4-8: D-H)
      { header: 'Product Name / Title *', techKey: 'name', width: 34 },
      { header: 'Brand', techKey: 'brand', width: 18 },
      { header: 'Vertical', techKey: 'vertical', width: 14 },
      { header: 'System SKU (Leave blank to auto-generate)', techKey: 'sku', width: 28 },
      { header: 'Barcode / EAN', techKey: 'gtin', width: 18 },
      // 3. Pricing & Packaging (Cols 9-12: I-L)
      { header: 'MRP (₹) *', techKey: 'mrp', width: 14 },
      { header: 'Selling Price (₹) *', techKey: 'sellingPrice', width: 18 },
      { header: 'Net Quantity *', techKey: 'netQuantity', width: 15 },
      { header: 'Unit *', techKey: 'unit', width: 12 },
      // 4. Compliance & Info (Cols 13-20: M-T)
      { header: 'Food Type (Veg/Non-Veg)', techKey: 'vegNonVeg', width: 24 },
      { header: 'Shelf Life Value', techKey: 'lifespanValue', width: 16 },
      { header: 'Shelf Life Unit', techKey: 'lifespanUnit', width: 16 },
      { header: 'Country of Origin', techKey: 'countryOfOrigin', width: 18 },
      { header: 'Manufacturer Name', techKey: 'manufacturer', width: 24 },
      { header: 'Storage Instructions / Conditions', techKey: 'storageInformation', width: 28 },
      { header: 'Description', techKey: 'description', width: 30 },
      { header: 'Image URLs (comma-separated)', techKey: 'imageUrls', width: 30 },
      // 5. Category Attributes (Cols 21-23: U-W)
      { header: 'Atta / Grain Type', techKey: 'attr_atta_type', width: 20 },
      { header: 'Milk / Dairy Type', techKey: 'attr_milk_type', width: 20 },
      { header: 'Packaging Type', techKey: 'attr_packaging_type', width: 18 },
      // 6. Clinical & Medical Specifics (Cols 24-36: X-AJ)
      { header: 'Generic / Salt Name', techKey: 'genericName', width: 26 },
      { header: 'Dosage Form', techKey: 'dosageForm', width: 18 },
      { header: 'Route of Administration', techKey: 'routeOfAdmin', width: 24 },
      { header: 'Strength', techKey: 'strength', width: 16 },
      { header: 'Prescription Required', techKey: 'prescriptionRequired', width: 22 },
      { header: 'Prescription Category', techKey: 'prescriptionCategory', width: 24 },
      { header: 'Cold Chain Required', techKey: 'coldChainRequired', width: 20 },
      { header: 'Therapeutic Indication', techKey: 'indication', width: 28 },
      { header: 'Directions for Use', techKey: 'usageInstructions', width: 28 },
      { header: 'Known Side Effects', techKey: 'sideEffects', width: 26 },
      { header: 'Safety Warnings & Precautions', techKey: 'disclaimer', width: 30 },
      { header: 'Marketer / Importer Name', techKey: 'marketerName', width: 24 },
      { header: 'Drug Licence Number', techKey: 'licenceNumber', width: 22 },
    ];

    wsData.columns = columns.map((c) => ({ width: c.width }));

    // Row 1: Section Groups
    const row1 = wsData.getRow(1);
    row1.height = 26;
    const groups = [
      { start: 1, end: 3, label: '1. Category Hierarchy', fill: GROUP_MAPPING_FILL },
      { start: 4, end: 8, label: '2. Product Identification', fill: GROUP_CORE_FILL },
      { start: 9, end: 12, label: '3. Pricing & Packaging', fill: GROUP_PRICE_FILL },
      { start: 13, end: 20, label: '4. Compliance & Info', fill: GROUP_COMPLIANCE_FILL },
      { start: 21, end: 23, label: '5. Category Attributes', fill: GROUP_ATTR_FILL },
      { start: 24, end: 36, label: '6. Clinical & Medical Regulatory Details', fill: GROUP_MED_FILL },
    ];

    for (const g of groups) {
      wsData.mergeCells(1, g.start, 1, g.end);
      const cell = row1.getCell(g.start);
      cell.value = g.label;
      cell.fill = g.fill;
      cell.font = GROUP_FONT;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }

    // Row 2: Human Friendly Headers
    const row2 = wsData.getRow(2);
    row2.height = 28;
    columns.forEach((col, idx) => {
      const cell = row2.getCell(idx + 1);
      cell.value = col.header;
      cell.fill = THEME_HEADER_FILL;
      cell.font = THEME_HEADER_FONT;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: '334155' } },
        bottom: { style: 'thin', color: { argb: '334155' } },
        left: { style: 'thin', color: { argb: '334155' } },
        right: { style: 'thin', color: { argb: '334155' } },
      };
    });

    // Row 3: Technical Keys
    const row3 = wsData.getRow(3);
    row3.height = 18;
    columns.forEach((col, idx) => {
      const cell = row3.getCell(idx + 1);
      cell.value = `[${col.techKey}]`;
      cell.fill = TECH_KEY_FILL;
      cell.font = TECH_KEY_FONT;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // 5 Pre-filled Sample Products in the Template
    const sampleProducts = [
      // 1. kirana 1
      [
        'Grocery & Staples', 'Atta, Rice, Oil & Dals', 'Atta & Flour',
        'kirana 1', 'ExtraHand Kirana', 'KIRANA', '', '8901030000001',
        250.00, 220.00, 5, 'kg',
        'Vegetarian', 6, 'Months', 'India', 'ITC Limited', 'Store in dry place',
        'Premium whole wheat flour', 'https://cdn.extrahand.in/products/kirana1.jpg',
        'Whole Wheat', '', 'Bag',
        '', '', '', '', '', '', '', '', '', '', '', '', ''
      ],
      // 2. kirana 2
      [
        'Fresh & Daily Essentials', 'Dairy', 'Milk',
        'kirana 2', 'ExtraHand Dairy', 'KIRANA', '', '8901030000002',
        60.00, 56.00, 1, 'L',
        'Vegetarian', 3, 'Days', 'India', 'Amul Dairy', 'Keep refrigerated at 4°C',
        'Fresh pasteurized milk', 'https://cdn.extrahand.in/products/kirana2.jpg',
        '', 'Toned', 'Pouch',
        '', '', '', '', '', '', '', '', '', '', '', '', ''
      ],
      // 3. medical 1
      [
        'Health & Wellness', 'Pharmacy & Wellness', 'OTC Products',
        'medical 1', 'ExtraHand Pharma', 'MEDICAL', '', '8901030000003',
        35.00, 30.00, 15, 'tablet',
        'N/A', 24, 'Months', 'India', 'Micro Labs Ltd', 'Store below 30°C in dry place',
        'Paracetamol tablets for fever and mild pain relief', 'https://cdn.extrahand.in/products/medical1.jpg',
        '', '', 'Strip',
        'Paracetamol', 'Tablet', 'Oral', '650 mg', 'NO', 'OTC / Non-Prescription', 'NO',
        'Fever, headache, body aches', '1 tablet after meals with water',
        'Nausea, allergic reaction if sensitive', 'Do not exceed 4 tabs in 24 hours. Avoid alcohol.',
        'Micro Labs Limited', 'DL-20B-10492'
      ],
      // 4. medical 2
      [
        'Health & Wellness', 'Pharmacy & Wellness', 'First Aid',
        'medical 2', 'ExtraHand Care', 'MEDICAL', '', '8901030000004',
        110.00, 95.00, 100, 'ml',
        'N/A', 36, 'Months', 'India', 'Reckitt Benckiser', 'Cool place away from direct sunlight',
        'Antiseptic disinfectant liquid for cuts and wounds', 'https://cdn.extrahand.in/products/medical2.jpg',
        '', '', 'Bottle',
        'Chlorhexidine Gluconate', 'Solution', 'Topical', '0.5% w/v', 'NO', 'General Sale', 'NO',
        'Minor cuts, wounds, insect bites and abrasions', 'Apply diluted gently using clean cotton',
        'Local skin irritation in rare cases', 'For external use only. Keep away from eyes.',
        'Reckitt Benckiser India', 'DL-20B-78219'
      ],
      // 5. medical 3
      [
        'Health & Wellness', 'Pharmacy & Wellness', 'Health Care Products',
        'medical 3', 'ExtraHand Rx', 'MEDICAL', '', '8901030000005',
        140.00, 120.00, 10, 'tablet',
        'N/A', 18, 'Months', 'India', 'Sun Pharma Ltd', 'Store below 25°C in moisture-proof pack',
        'Broad-spectrum antibiotic for bacterial infections', 'https://cdn.extrahand.in/products/medical3.jpg',
        '', '', 'Strip',
        'Amoxicillin & Potassium Clavulanate', 'Tablet', 'Oral', '625 mg', 'YES', 'Schedule H', 'NO',
        'Respiratory tract, ear, nose, throat & skin infections', 'Take 1 tablet twice daily with meals',
        'Diarrhoea, nausea, vomiting, skin rash', 'Schedule H Warning: To be sold on medical prescription only.',
        'Sun Pharmaceutical Industries Ltd', 'DL-21B-45120'
      ]
    ];

    sampleProducts.forEach((rowArr) => {
      const r = wsData.addRow(rowArr);
      r.height = 22;
      r.getCell(9).numFmt = '₹#,##0.00';
      r.getCell(10).numFmt = '₹#,##0.00';
    });

    // Valid_Values exact column coordinates:
    // A: Categories, B: Subcategories, C: ProductTypes, D: Units, E: Verticals,
    // F: FoodTypes, G: LifespanUnits, H: YesNo, I: DosageForms, J: RoutesOfAdmin,
    // K: PrescriptionCategories, L: PackagingTypes, M: AttaTypes, N: MilkTypes
    const catRange = `Valid_Values!$A$2:$A$${Math.max(lookupData.Categories.length + 1, 2)}`;
    const subcatRange = `Valid_Values!$B$2:$B$${Math.max(lookupData.Subcategories.length + 1, 2)}`;
    const ptRange = `Valid_Values!$C$2:$C$${Math.max(lookupData.ProductTypes.length + 1, 2)}`;
    const unitRange = `Valid_Values!$D$2:$D$${standardUnits.length + 1}`;
    const verticalRange = `Valid_Values!$E$2:$E$${verticals.length + 1}`;
    const foodTypeRange = `Valid_Values!$F$2:$F$${foodTypes.length + 1}`;
    const lifespanUnitRange = `Valid_Values!$G$2:$G$${lifespanUnits.length + 1}`;
    const yesNoRange = `Valid_Values!$H$2:$H$${yesNo.length + 1}`;
    const dosageRange = `Valid_Values!$I$2:$I$${dosageForms.length + 1}`;
    const routeRange = `Valid_Values!$J$2:$J$${routesOfAdmin.length + 1}`;
    const rxCatRange = `Valid_Values!$K$2:$K$${prescriptionCategories.length + 1}`;
    const pkgRange = `Valid_Values!$L$2:$L$${pkgOptions.length + 1}`;
    const attaRange = `Valid_Values!$M$2:$M$${attaOptions.length + 1}`;
    const milkRange = `Valid_Values!$N$2:$N$${milkOptions.length + 1}`;

    for (let r = 4; r <= 300; r++) {
      wsData.getCell(`A${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [catRange] };
      wsData.getCell(`B${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [subcatRange] };
      wsData.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [ptRange] };
      wsData.getCell(`F${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [verticalRange] };
      wsData.getCell(`L${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [unitRange] };
      wsData.getCell(`M${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [foodTypeRange] };
      wsData.getCell(`O${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [lifespanUnitRange] };
      wsData.getCell(`U${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [attaRange] };
      wsData.getCell(`V${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [milkRange] };
      wsData.getCell(`W${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [pkgRange] };
      wsData.getCell(`Y${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [dosageRange] };
      wsData.getCell(`Z${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [routeRange] };
      wsData.getCell(`AB${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [yesNoRange] };
      wsData.getCell(`AC${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [rxCatRange] };
      wsData.getCell(`AD${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [yesNoRange] };
    }

    return workbook;
  }

  /**
   * Ingests a populated Excel file into MongoDB MasterProduct collection.
   */
  static async ingestBulkProducts(buffer: Buffer, userId?: string): Promise<BulkUploadResult> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    let worksheet = workbook.getWorksheet('Master_Products');
    if (!worksheet) {
      worksheet = workbook.worksheets[0];
    }
    if (!worksheet) {
      throw new Error('Workbook contains no readable worksheets.');
    }

    // 1. Identify Column Map from Row 3 (Technical Keys) or Row 2 (Headers)
    const colIndexToKey = new Map<number, string>();
    const row2 = worksheet.getRow(2);
    const row3 = worksheet.getRow(3);

    const headerNameToKey: Record<string, string> = {
      category: 'categoryName',
      'category *': 'categoryName',
      subcategory: 'subcategoryName',
      'subcategory *': 'subcategoryName',
      'product type': 'productTypeName',
      'product type *': 'productTypeName',
      'product name / title *': 'name',
      'product title / name *': 'name',
      'product name': 'name',
      title: 'name',
      name: 'name',
      brand: 'brand',
      vertical: 'vertical',
      'system sku': 'sku',
      sku: 'sku',
      'barcode / ean': 'gtin',
      barcode: 'gtin',
      gtin: 'gtin',
      'mrp (₹) *': 'mrp',
      mrp: 'mrp',
      'selling price (₹) *': 'sellingPrice',
      'selling price': 'sellingPrice',
      'net quantity *': 'netQuantity',
      'net quantity': 'netQuantity',
      'unit *': 'unit',
      unit: 'unit',
      'food type (veg/non-veg)': 'vegNonVeg',
      'food type': 'vegNonVeg',
      'shelf life value': 'lifespanValue',
      'shelf life unit': 'lifespanUnit',
      'country of origin': 'countryOfOrigin',
      'manufacturer name': 'manufacturer',
      manufacturer: 'manufacturer',
      'storage instructions / conditions': 'storageInformation',
      'storage instructions': 'storageInformation',
      'storage condition': 'storageInformation',
      description: 'description',
      'image urls (comma-separated)': 'imageUrls',
      'image urls': 'imageUrls',
      images: 'imageUrls',
      'atta / grain type': 'attr_atta_type',
      'milk / dairy type': 'attr_milk_type',
      'packaging type': 'attr_packaging_type',
      'generic / salt name': 'genericName',
      'generic name': 'genericName',
      genericname: 'genericName',
      'dosage form': 'dosageForm',
      dosageform: 'dosageForm',
      'route of administration': 'routeOfAdmin',
      routeofadmin: 'routeOfAdmin',
      route: 'routeOfAdmin',
      strength: 'strength',
      'prescription required': 'prescriptionRequired',
      prescriptionrequired: 'prescriptionRequired',
      'prescription category': 'prescriptionCategory',
      prescriptioncategory: 'prescriptionCategory',
      'cold chain required': 'coldChainRequired',
      coldchainrequired: 'coldChainRequired',
      'therapeutic indication': 'indication',
      indication: 'indication',
      'directions for use': 'usageInstructions',
      usageinstructions: 'usageInstructions',
      'known side effects': 'sideEffects',
      sideeffects: 'sideEffects',
      'safety warnings & precautions': 'disclaimer',
      safetywarnings: 'disclaimer',
      disclaimer: 'disclaimer',
      'marketer / importer name': 'marketerName',
      marketername: 'marketerName',
      'drug licence number': 'licenceNumber',
      licencenumber: 'licenceNumber',
    };

    // Scan columns 1 to 45
    for (let col = 1; col <= 45; col++) {
      const r3Val = String(row3.getCell(col).value || '').trim();
      const m = /^\[([a-zA-Z0-9_]+)\]$/.exec(r3Val);
      if (m) {
        colIndexToKey.set(col, m[1]);
        continue;
      }

      const r2Val = String(row2.getCell(col).value || '').trim().toLowerCase();
      if (headerNameToKey[r2Val]) {
        colIndexToKey.set(col, headerNameToKey[r2Val]);
      }
    }

    if (!colIndexToKey.size) {
      throw new Error('Unable to identify column headers. Please use the official ExtraHand template.');
    }

    // 2. Pre-load Taxonomies into Fast Lookup Maps
    const [allCategories, allSubcategories, allProductTypes, allAttributes] = await Promise.all([
      Category.find({}).lean(),
      Subcategory.find({}).lean(),
      ProductType.find({}).lean(),
      Attribute.find({}).lean(),
    ]);

    const catMapByName = new Map<string, any>();
    allCategories.forEach((c) => catMapByName.set(c.name.trim().toLowerCase(), c));

    const subcatMapByCatAndName = new Map<string, any>();
    allSubcategories.forEach((s) => {
      const key = `${s.categoryId.toString()}_${s.name.trim().toLowerCase()}`;
      subcatMapByCatAndName.set(key, s);
    });

    const ptMapBySubcatAndName = new Map<string, any>();
    allProductTypes.forEach((pt) => {
      const key = `${pt.subcategoryId.toString()}_${pt.name.trim().toLowerCase()}`;
      ptMapBySubcatAndName.set(key, pt);
    });

    const attrMapByKey = new Map<string, any>();
    allAttributes.forEach((a) => {
      if (a.key) attrMapByKey.set(a.key.trim().toLowerCase(), a);
    });

    // 3. Iterate through Data Rows
    const errors: BulkUploadRowError[] = [];
    const validRowsToCreate: Array<{
      productData: any;
      images: Array<{ imageUrl: string; isPrimary: boolean; displayOrder: number }>;
      rowNumber: number;
    }> = [];

    const totalRowCount = worksheet.rowCount;
    let actualRowsEvaluated = 0;

    for (let r = 4; r <= totalRowCount; r++) {
      const row = worksheet.getRow(r);

      const rowData: Record<string, any> = {};
      let hasAnyValue = false;

      colIndexToKey.forEach((key, colIndex) => {
        let val = row.getCell(colIndex).value;
        if (val !== null && val !== undefined) {
          if (typeof val === 'object' && 'text' in val) {
            val = (val as any).text;
          }
          if (typeof val === 'string') {
            val = val.trim();
          }
          if (val !== '') {
            hasAnyValue = true;
          }
          rowData[key] = val;
        }
      });

      if (!hasAnyValue) continue;
      actualRowsEvaluated++;

      const rowErrors: string[] = [];
      const productName = String(rowData.name || '').trim();

      // Core Mandatory Fields
      if (!productName) rowErrors.push('Product Name is required');
      if (!rowData.categoryName) rowErrors.push('Category is required');
      if (!rowData.subcategoryName) rowErrors.push('Subcategory is required');
      if (!rowData.productTypeName) rowErrors.push('Product Type is required');
      if (rowData.mrp === undefined || rowData.mrp === '') rowErrors.push('MRP is required');
      if (rowData.sellingPrice === undefined || rowData.sellingPrice === '') rowErrors.push('Selling Price is required');
      if (rowData.netQuantity === undefined || rowData.netQuantity === '') rowErrors.push('Net Quantity is required');
      if (!rowData.unit) rowErrors.push('Unit is required');

      // Verify Hierarchy
      const catNameClean = String(rowData.categoryName || '').trim().toLowerCase();
      const matchedCat = catMapByName.get(catNameClean);
      if (rowData.categoryName && !matchedCat) {
        rowErrors.push(`Category "${rowData.categoryName}" does not exist`);
      }

      let matchedSubcat: any = null;
      if (matchedCat && rowData.subcategoryName) {
        const subcatKey = `${matchedCat._id.toString()}_${String(rowData.subcategoryName).trim().toLowerCase()}`;
        matchedSubcat = subcatMapByCatAndName.get(subcatKey);
        if (!matchedSubcat) {
          rowErrors.push(`Subcategory "${rowData.subcategoryName}" not found under Category "${matchedCat.name}"`);
        }
      }

      let matchedPT: any = null;
      if (matchedSubcat && rowData.productTypeName) {
        const ptKey = `${matchedSubcat._id.toString()}_${String(rowData.productTypeName).trim().toLowerCase()}`;
        matchedPT = ptMapBySubcatAndName.get(ptKey);
        if (!matchedPT) {
          rowErrors.push(`Product Type "${rowData.productTypeName}" not found under Subcategory "${matchedSubcat.name}"`);
        }
      }

      // Determine Vertical
      let vertical: 'KIRANA' | 'MEDICAL' | 'SEASONAL' = 'KIRANA';
      let isMedicalProduct = false;
      let isSeasonalProduct = false;

      const rawVertical = String(rowData.vertical || '').toUpperCase();
      if (rawVertical === 'MEDICAL' || matchedCat?.vertical === 'MEDICAL' || matchedCat?.code === 'MED') {
        vertical = 'MEDICAL';
        isMedicalProduct = true;
      } else if (rawVertical === 'SEASONAL' || matchedCat?.vertical === 'SEASONAL' || matchedCat?.code === 'FEST') {
        vertical = 'SEASONAL';
        isSeasonalProduct = true;
      }

      // Medical Clinical Validation
      if (isMedicalProduct) {
        if (!rowData.genericName) rowErrors.push('Generic / Salt Name is required for Medical products');
        if (!rowData.dosageForm) rowErrors.push('Dosage Form is required for Medical products (e.g. Tablet, Syrup, Ointment)');
        if (!rowData.routeOfAdmin) rowErrors.push('Route of Administration is required for Medical products (e.g. Oral, Topical)');
        if (!rowData.strength) rowErrors.push('Strength is required for Medical products (e.g. 500 mg, 650 mg)');
      }

      // Validate Prices
      const mrpNum = parseFloat(String(rowData.mrp).replace(/[₹,\s]/g, ''));
      const spNum = parseFloat(String(rowData.sellingPrice).replace(/[₹,\s]/g, ''));

      if (isNaN(mrpNum) || mrpNum <= 0) {
        rowErrors.push(`Invalid MRP value: ${rowData.mrp}`);
      }
      if (isNaN(spNum) || spNum < 0) {
        rowErrors.push(`Invalid Selling Price value: ${rowData.sellingPrice}`);
      }
      if (!isNaN(mrpNum) && !isNaN(spNum) && spNum > mrpNum) {
        rowErrors.push(`Selling Price (₹${spNum}) cannot be greater than MRP (₹${mrpNum})`);
      }

      // Validate Net Quantity
      const netQtyNum = parseFloat(String(rowData.netQuantity).trim());
      if (isNaN(netQtyNum) || netQtyNum <= 0) {
        rowErrors.push(`Invalid Net Quantity: ${rowData.netQuantity}`);
      }

      if (rowErrors.length > 0) {
        errors.push({
          rowNumber: r,
          productName: productName || `Row ${r}`,
          reasons: rowErrors,
        });
        continue;
      }

      // Pricing in Paise
      const mrpPaise = Math.round(mrpNum * 100);
      const sellingPricePaise = Math.round(spNum * 100);

      // Attributes
      const attributesPayload: ProductAttributeValue[] = [];
      const netQtyAttr = attrMapByKey.get('net_quantity');
      if (netQtyAttr) {
        attributesPayload.push({ attributeId: netQtyAttr._id, value: netQtyNum });
      }
      const unitAttr = attrMapByKey.get('unit');
      if (unitAttr) {
        attributesPayload.push({ attributeId: unitAttr._id, value: String(rowData.unit).trim() });
      }
      if (rowData.attr_atta_type) {
        const a = attrMapByKey.get('atta_type');
        if (a) attributesPayload.push({ attributeId: a._id, value: String(rowData.attr_atta_type).trim() });
      }
      if (rowData.attr_milk_type) {
        const a = attrMapByKey.get('milk_type');
        if (a) attributesPayload.push({ attributeId: a._id, value: String(rowData.attr_milk_type).trim() });
      }
      if (rowData.attr_packaging_type) {
        const a = attrMapByKey.get('packaging_type');
        if (a) attributesPayload.push({ attributeId: a._id, value: String(rowData.attr_packaging_type).trim() });
      }
      if (rowData.vegNonVeg) {
        const a = attrMapByKey.get('veg_nonveg');
        if (a) attributesPayload.push({ attributeId: a._id, value: String(rowData.vegNonVeg).trim() });
      }

      // Product Information / Compliance & Clinical Details
      const productInfo: Record<string, any> = {};
      if (rowData.manufacturer) productInfo.manufacturer = String(rowData.manufacturer).trim();
      if (rowData.storageInformation) productInfo.storageInformation = String(rowData.storageInformation).trim();
      if (rowData.countryOfOrigin) productInfo.countryOfOrigin = String(rowData.countryOfOrigin).trim();

      // Medical & Clinical Fields
      if (rowData.genericName) productInfo.genericName = String(rowData.genericName).trim();
      if (rowData.dosageForm) productInfo.dosageForm = String(rowData.dosageForm).trim();
      if (rowData.routeOfAdmin) productInfo.routeOfAdmin = String(rowData.routeOfAdmin).trim();
      if (rowData.strength) productInfo.strength = String(rowData.strength).trim();
      if (rowData.prescriptionCategory) productInfo.prescriptionCategory = String(rowData.prescriptionCategory).trim();
      if (rowData.indication) productInfo.indication = String(rowData.indication).trim();
      if (rowData.usageInstructions) productInfo.usageInstructions = String(rowData.usageInstructions).trim();
      if (rowData.sideEffects) productInfo.sideEffects = String(rowData.sideEffects).trim();
      if (rowData.disclaimer) productInfo.disclaimer = String(rowData.disclaimer).trim();
      if (rowData.marketerName) productInfo.marketerName = String(rowData.marketerName).trim();
      if (rowData.licenceNumber) productInfo.licenceNumber = String(rowData.licenceNumber).trim();

      if (rowData.prescriptionRequired !== undefined && rowData.prescriptionRequired !== '') {
        const rxStr = String(rowData.prescriptionRequired).trim().toUpperCase();
        productInfo.prescriptionRequired = rxStr === 'YES' || rxStr === 'TRUE' || rxStr === '1';
      }

      if (rowData.coldChainRequired !== undefined && rowData.coldChainRequired !== '') {
        const ccStr = String(rowData.coldChainRequired).trim().toUpperCase();
        productInfo.coldChainRequired = ccStr === 'YES' || ccStr === 'TRUE' || ccStr === '1';
      }

      // Parse Images
      const images: Array<{ imageUrl: string; isPrimary: boolean; displayOrder: number }> = [];
      if (rowData.imageUrls) {
        const urls = String(rowData.imageUrls)
          .split(/[\n,]/)
          .map((u) => u.trim())
          .filter(Boolean);
        urls.forEach((url, idx) => {
          images.push({
            imageUrl: url,
            isPrimary: idx === 0,
            displayOrder: idx,
          });
        });
      }

      // Lifespan
      let lifespanValue: number | undefined;
      if (rowData.lifespanValue) {
        const lv = parseInt(String(rowData.lifespanValue), 10);
        if (!isNaN(lv) && lv > 0) lifespanValue = lv;
      }

      const productPayload: any = {
        categoryId: matchedCat._id,
        subcategoryId: matchedSubcat._id,
        productTypeId: matchedPT._id,
        name: productName,
        brand: rowData.brand ? String(rowData.brand).trim() : undefined,
        description: rowData.description ? String(rowData.description).trim() : undefined,
        gtin: rowData.gtin ? String(rowData.gtin).trim() : undefined,
        sellingPricePaise,
        mrpPaise,
        vertical,
        isMedicalProduct,
        isSeasonalProduct,
        lifespanValue,
        lifespanUnit: rowData.lifespanUnit ? String(rowData.lifespanUnit).trim() : undefined,
        attributes: attributesPayload,
        productInformation: Object.keys(productInfo).length ? normalizeProductInformation(productInfo) : undefined,
        status: 'ACTIVE',
      };

      if (rowData.sku && String(rowData.sku).trim()) {
        productPayload.sku = String(rowData.sku).trim();
      }

      validRowsToCreate.push({
        productData: productPayload,
        images,
        rowNumber: r,
      });
    }

    // 4. Ingest Valid Rows into MongoDB
    let insertedCount = 0;

    for (const item of validRowsToCreate) {
      try {
        if (!item.productData.sku) {
          item.productData.sku = await generateMasterProductSku(
            item.productData.categoryId.toString(),
            item.productData.name
          );
        }

        const slugBase = `${item.productData.name} ${item.productData.brand || ''}`;
        const slug = await uniqueSlug(
          slugBase,
          async (s) => !!(await MasterProduct.findOne({ slug: s }))
        );

        const createdProduct = await MasterProduct.create({
          ...item.productData,
          slug,
          createdBy: userId,
          updatedBy: userId,
        });

        if (item.images.length > 0) {
          await ProductImage.insertMany(
            item.images.map((img) => ({
              masterProductId: createdProduct._id,
              imageUrl: img.imageUrl,
              altText: createdProduct.name,
              displayOrder: img.displayOrder,
              isPrimary: img.isPrimary,
            }))
          );
        }

        insertedCount++;
      } catch (err: any) {
        errors.push({
          rowNumber: item.rowNumber,
          productName: item.productData.name,
          reasons: [err.message || 'Database error during insertion'],
        });
      }
    }

    return {
      totalRows: actualRowsEvaluated,
      insertedCount,
      failedCount: errors.length,
      errors,
    };
  }
}

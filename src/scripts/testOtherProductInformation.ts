import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import MasterProduct from '../models/MasterProduct';
import { buildPdpInformation } from '../services/StorefrontService';
import {
  applyProductInformationPatch,
  mapStorefrontProductInformation,
  normalizeProductInformation,
} from '../utils/productInformation';
import { mergeResubmittedProductImages } from '../utils/productSubmissionImages';

const customAttributes = [
  { label: 'Material', value: 'Cotton' },
  { label: 'Care', value: 'Hand wash' },
];
const normalized = normalizeProductInformation({
  customAttributes,
  manufacturerContactNumber: '  +91 12345 67890 ',
  manufacturerEmail: ' maker@example.com ',
  importerDetails: 'Imported by Example Imports',
  certificationNumber: 'CERT-123',
});

assert.deepEqual(normalized?.customAttributes, customAttributes);
assert.equal(normalized?.manufacturerContactNumber, '+91 12345 67890');
assert.equal(normalized?.manufacturerEmail, 'maker@example.com');
assert.equal(normalized?.importerDetails, 'Imported by Example Imports');
assert.equal(normalized?.certificationNumber, 'CERT-123');
assert.equal(normalizeProductInformation({ customAttributes: [] }), undefined);
assert.throws(() => normalizeProductInformation({ customAttributes: 'invalid' }));
assert.throws(() => normalizeProductInformation({ customAttributes: [{ label: ' ', value: 'x' }] }));
assert.throws(() => normalizeProductInformation({
  customAttributes: [{ label: 'Material', value: 'Cotton' }, { label: ' material ', value: 'Wool' }],
}));

const patched = applyProductInformationPatch(normalized, {
  customAttributes: [{ label: 'Material', value: 'Recycled cotton' }],
});
assert.equal(patched?.manufacturerEmail, 'maker@example.com');
assert.deepEqual(patched?.customAttributes, [{ label: 'Material', value: 'Recycled cotton' }]);
assert.equal(
  applyProductInformationPatch(patched, { customAttributes: [] })?.customAttributes,
  undefined,
);
assert.deepEqual(
  mergeResubmittedProductImages(
    ['cover-old.jpg', 'extra-a.jpg', 'extra-b.jpg', 'ingredients-old.jpg'],
    'cover-old.jpg',
    'ingredients-old.jpg',
    'cover-new.jpg',
    'ingredients-new.jpg',
    true,
    true,
  ),
  ['cover-new.jpg', 'extra-a.jpg', 'extra-b.jpg', 'ingredients-new.jpg'],
);

const storefrontInformation = mapStorefrontProductInformation(normalized);
assert.deepEqual(storefrontInformation?.customAttributes, customAttributes);
assert.equal(storefrontInformation?.manufacturerContactNumber, '+91 12345 67890');
const pdpRows = buildPdpInformation({
  unit: '1 piece',
  attributes: [],
  keyMap: new Map(),
  productInformation: storefrontInformation,
  seller: { name: 'Seller', address: 'Address', license: 'License', gstin: 'GSTIN' },
});
assert(pdpRows.some((row) => row.label === 'Manufacturer email' && row.value === 'maker@example.com'));
assert(pdpRows.some((row) => row.label === 'Material' && row.value === 'Cotton'));
assert(pdpRows.some((row) => row.label === 'Importer details' && row.value === 'Imported by Example Imports'));

const product = new MasterProduct({
  categoryId: new mongoose.Types.ObjectId(),
  subcategoryId: new mongoose.Types.ObjectId(),
  productTypeId: new mongoose.Types.ObjectId(),
  name: 'Other Product Schema Test',
  slug: 'other-product-schema-test',
  sku: 'OTHER-SCHEMA-TEST',
  productInformation: normalized,
});
assert.equal(product.validateSync(), undefined);
assert.deepEqual(
  product.productInformation?.customAttributes?.map(({ label, value }) => ({ label, value })),
  customAttributes,
);
assert.equal(product.productInformation?.manufacturerEmail, 'maker@example.com');

console.log('Other Product Information tests passed.');

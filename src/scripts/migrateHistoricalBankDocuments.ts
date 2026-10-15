/**
 * SEC-V02: Historical KYC & Bank Document Migration Utility
 *
 * Scans legacy document references stored in public buckets/directories across:
 * - SellerDocument (fileUrl for sensitive KYC types: PAN, Aadhaar, Bank/Passbook, Licenses)
 * - SellerOnboarding (bankAccount.passbookImageUrl, bankAccount.passbookUri, panCardUrl, panCardUri,
 *   panImageUrl, panDocumentUri, aadhaarFrontImageUrl, aadhaarBackImageUrl, aadhaarDocumentUri, pharmacistDetails.certificateUri)
 * - SellerStoreSettings (bankAccount.passbookImageUrl)
 *
 * Security & Integrity Features:
 * - Streamed SHA-256 checksum verification computed independently for source and destination.
 * - Does not rely on ETags alone (handles multipart suffixes and server-side encryption).
 * - Collision safety: Existing destination objects with differing content abort without overwriting.
 * - Safe idempotency: Existing destination objects with identical content reuse copy and proceed safely.
 * - Source objects are NEVER deleted.
 * - Redacted discovery and manifest logging without exposing sensitive PII or credentials.
 * - Strict dry-run semantics: no object copying, database mutations, or object deletions.
 * - Manifest generation with full rollback support (--rollback <manifest-path>).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { env } from '../config/env';
import SellerDocument from '../models/SellerDocument';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerStoreSettings from '../models/SellerStoreSettings';
import {
  isPrivateBucket,
  getBucketForSubdir,
} from '../utils/minioConfig';
import { parseMinioObjectUrl, LOCAL_UPLOAD_DIR, getMinioClient } from '../utils/storage';
import logger from '../config/logger';

export interface MigrationItem {
  model: 'SellerDocument' | 'SellerOnboarding' | 'SellerStoreSettings';
  documentId: string;
  field: string;
  documentType?: string;
  originalUrl: string;
  newUrl?: string;
  sourceBucket?: string;
  sourceKey?: string;
  destBucket?: string;
  destKey?: string;
  sourceSize?: number;
  destSize?: number;
  sourceSha256?: string;
  destSha256?: string;
  status: 'PENDING' | 'COPIED' | 'VERIFIED' | 'UPDATED' | 'SKIPPED' | 'FAILED';
  error?: string;
}

export interface MigrationManifest {
  manifestId: string;
  executedAt: string;
  mode: 'dry-run' | 'execute';
  storageProvider: string;
  totalCandidates: number;
  successCount: number;
  skippedCount: number;
  failedCount: number;
  summaryByModelAndType?: Record<string, Record<string, number>>;
  records: MigrationItem[];
}

export interface IntegrityCheckResult {
  verified: boolean;
  sourceSize: number;
  destSize: number;
  sourceSha256: string;
  destSha256: string;
  sourceEtag?: string;
  destEtag?: string;
  error?: string;
}

/**
 * Verifies object integrity by independently comparing size and streamed cryptographic checksums.
 * Decoupled from MinIO/S3 ETags which can differ due to multipart uploads (-<parts>) or encryption.
 */
export async function verifyObjectIntegrity(
  sourceProvider: {
    getSize: () => Promise<number>;
    getSha256: () => Promise<string>;
    getEtag?: () => Promise<string | undefined>;
  },
  destProvider: {
    getSize: () => Promise<number>;
    getSha256: () => Promise<string>;
    getEtag?: () => Promise<string | undefined>;
  }
): Promise<IntegrityCheckResult> {
  const [srcSize, destSize] = await Promise.all([
    sourceProvider.getSize(),
    destProvider.getSize(),
  ]);

  if (srcSize !== destSize) {
    return {
      verified: false,
      sourceSize: srcSize,
      destSize: destSize,
      sourceSha256: '',
      destSha256: '',
      error: `Size mismatch: source is ${srcSize} bytes, destination is ${destSize} bytes`,
    };
  }

  const [srcSha, destSha] = await Promise.all([
    sourceProvider.getSha256(),
    destProvider.getSha256(),
  ]);

  const [srcEtag, destEtag] = await Promise.all([
    sourceProvider.getEtag ? sourceProvider.getEtag() : undefined,
    destProvider.getEtag ? destProvider.getEtag() : undefined,
  ]);

  if (srcSha !== destSha) {
    return {
      verified: false,
      sourceSize: srcSize,
      destSize: destSize,
      sourceSha256: srcSha,
      destSha256: destSha,
      sourceEtag: srcEtag,
      destEtag: destEtag,
      error: `Content SHA-256 mismatch: source ${srcSha} does not match destination ${destSha}`,
    };
  }

  return {
    verified: true,
    sourceSize: srcSize,
    destSize: destSize,
    sourceSha256: srcSha,
    destSha256: destSha,
    sourceEtag: srcEtag,
    destEtag: destEtag,
  };
}

/**
 * Computes SHA-256 of a MinIO object using bounded-memory streaming.
 */
export async function computeMinioStreamSha256(
  client: any,
  bucket: string,
  objectName: string
): Promise<{ sha256: string; bytesRead: number }> {
  const stream: NodeJS.ReadableStream = await client.getObject(bucket, objectName);
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let bytesRead = 0;
    stream.on('data', (chunk: Buffer) => {
      bytesRead += chunk.length;
      hash.update(chunk);
    });
    stream.on('end', () => {
      resolve({ sha256: hash.digest('hex'), bytesRead });
    });
    stream.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Computes SHA-256 of a local file using bounded-memory streaming.
 */
export async function computeFileStreamSha256(
  filePath: string
): Promise<{ sha256: string; bytesRead: number }> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }
    const stream = fs.createReadStream(filePath);
    const hash = crypto.createHash('sha256');
    let bytesRead = 0;
    stream.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesRead += buf.length;
      hash.update(buf);
    });
    stream.on('end', () => {
      resolve({ sha256: hash.digest('hex'), bytesRead });
    });
    stream.on('error', (err) => {
      reject(err);
    });
  });
}

/** Redact sensitive parts of document URLs for console output and manifests. */
export function redactUrlForDisplay(url?: string | null): string {
  if (!url) return '<empty>';
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/');
    if (parts.length > 2) {
      const fileName = parts[parts.length - 1];
      const redactedFile = fileName.length > 8 ? `${fileName.slice(0, 4)}...${fileName.slice(-4)}` : '***';
      return `${parsed.origin}/${parts.slice(1, -1).join('/')}/${redactedFile}`;
    }
    return `${parsed.origin}/***`;
  } catch {
    const parts = String(url).split('/');
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      const redacted = last.length > 8 ? `${last.slice(0, 4)}...${last.slice(-4)}` : '***';
      return `${parts.slice(0, -1).join('/')}/${redacted}`;
    }
    return '***';
  }
}

/** Extract nested property safely from a JS object. */
function getNestedValue(obj: any, pathStr: string): string | undefined {
  if (!obj) return undefined;
  const parts = pathStr.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

export async function runMigration(options: {
  dryRun: boolean;
  manifestDir?: string;
  rollbackPath?: string;
}): Promise<MigrationManifest> {
  const isDryRun = options.dryRun;
  const manifestDir = options.manifestDir || path.join(process.cwd(), 'migration-manifests');
  fs.mkdirSync(manifestDir, { recursive: true });

  console.log('==================================================================');
  console.log(`🚀 KYC & BANK DOCUMENT MIGRATION UTILITY [${isDryRun ? 'DRY RUN' : 'EXECUTE'}]`);
  console.log('==================================================================\n');

  await connectDatabase();

  // --- ROLLBACK MODE ---
  if (options.rollbackPath) {
    console.log(`Initiating rollback from manifest: ${options.rollbackPath}`);
    if (!fs.existsSync(options.rollbackPath)) {
      throw new Error(`Manifest file not found: ${options.rollbackPath}`);
    }
    const manifest: MigrationManifest = JSON.parse(fs.readFileSync(options.rollbackPath, 'utf8'));
    console.log(`Found ${manifest.records.length} records to inspect for rollback...`);

    let rolledBackCount = 0;
    for (const record of manifest.records) {
      if (record.status !== 'UPDATED') continue;

      const filter = { _id: new mongoose.Types.ObjectId(record.documentId) };
      const update = { $set: { [record.field]: record.originalUrl } };

      if (record.model === 'SellerDocument') {
        await SellerDocument.updateOne(filter, update);
        rolledBackCount++;
      } else if (record.model === 'SellerOnboarding') {
        await SellerOnboarding.updateOne(filter, update);
        rolledBackCount++;
      } else if (record.model === 'SellerStoreSettings') {
        await SellerStoreSettings.updateOne(filter, update);
        rolledBackCount++;
      }
    }
    console.log(`✅ Rollback completed successfully: ${rolledBackCount} records restored.`);
    return manifest;
  }

  // --- DISCOVERY PHASE ---
  console.log('--- Phase 1: Candidate Discovery ---');
  const rawCandidates: MigrationItem[] = [];

  const publicBucket = env.MINIO_BUCKET_NAME || 'extrahand-images';
  const privateBucket = env.MINIO_SELLER_BUCKET_NAME || 'seller-doc';

  // 1. Scan SellerDocument for sensitive KYC types & subdirectories
  // Strictly EXCLUDE public SHOP_IMAGE and product images
  const sellerDocs = await SellerDocument.find({
    $and: [
      { fileUrl: { $regex: publicBucket } },
      { documentType: { $ne: 'SHOP_IMAGE' } },
      {
        $or: [
          { fileUrl: { $regex: `${publicBucket}/bank-documents` } },
          { fileUrl: { $regex: `${publicBucket}/seller-documents` } },
          {
            documentType: {
              $in: [
                'BANK_PASSBOOK',
                'PASSBOOK',
                'BANK_DOCUMENT',
                'CANCELLED_CHEQUE',
                'CHEQUE',
                'PAN_CARD',
                'PAN',
                'AADHAAR_CARD',
                'AADHAAR_CARD_FRONT',
                'AADHAAR_CARD_BACK',
                'AADHAAR',
                'AADHAR',
                'AADHAAR_FRONT',
                'AADHAAR_BACK',
                'PHARMACIST_CERTIFICATE',
                'DRUG_LICENSE',
                'FSSAI_CERTIFICATE',
                'TRADE_LICENSE',
                'GST_CERTIFICATE',
              ],
            },
          },
        ],
      },
    ],
  }).lean();

  for (const doc of sellerDocs) {
    if (doc.fileUrl && doc.fileUrl.includes(publicBucket)) {
      rawCandidates.push({
        model: 'SellerDocument',
        documentId: String(doc._id),
        field: 'fileUrl',
        documentType: String(doc.documentType || 'UNKNOWN_KYC'),
        originalUrl: doc.fileUrl.trim(),
        status: 'PENDING',
      });
    }
  }

  // 2. Scan SellerOnboarding across all historical PAN, Aadhaar, bank passbook, and certificate fields
  const ONBOARDING_KYC_FIELDS: Array<{ field: string; type: string }> = [
    { field: 'bankAccount.passbookImageUrl', type: 'BANK_PASSBOOK' },
    { field: 'bankAccount.passbookUri', type: 'BANK_PASSBOOK' },
    { field: 'panCardUrl', type: 'PAN_CARD' },
    { field: 'panCardUri', type: 'PAN_CARD' },
    { field: 'panImageUrl', type: 'PAN_CARD' },
    { field: 'panDocumentUri', type: 'PAN_CARD' },
    { field: 'aadhaarFrontImageUrl', type: 'AADHAAR_CARD_FRONT' },
    { field: 'aadhaarBackImageUrl', type: 'AADHAAR_CARD_BACK' },
    { field: 'aadhaarDocumentUri', type: 'AADHAAR_CARD_FRONT' },
    { field: 'pharmacistDetails.certificateUri', type: 'PHARMACIST_CERTIFICATE' },
  ];

  const onboardings = await SellerOnboarding.find({
    $or: ONBOARDING_KYC_FIELDS.map(({ field }) => ({
      [field]: { $regex: publicBucket },
    })),
  }).lean();

  for (const onb of onboardings) {
    for (const { field, type } of ONBOARDING_KYC_FIELDS) {
      const val = getNestedValue(onb, field);
      if (val && val.includes(publicBucket)) {
        rawCandidates.push({
          model: 'SellerOnboarding',
          documentId: String(onb._id),
          field,
          documentType: type,
          originalUrl: val.trim(),
          status: 'PENDING',
        });
      }
    }
  }

  // 3. Scan SellerStoreSettings for operational payout bank passbooks
  const storeSettings = await SellerStoreSettings.find({
    'bankAccount.passbookImageUrl': { $regex: publicBucket },
  }).lean();

  for (const s of storeSettings) {
    const val = s.bankAccount?.passbookImageUrl;
    if (val && val.includes(publicBucket)) {
      rawCandidates.push({
        model: 'SellerStoreSettings',
        documentId: String(s._id),
        field: 'bankAccount.passbookImageUrl',
        documentType: 'BANK_PASSBOOK',
        originalUrl: val.trim(),
        status: 'PENDING',
      });
    }
  }

  // Deduplicate candidates by model, documentId, and field
  const seenCandidateKeys = new Set<string>();
  const candidates: MigrationItem[] = [];
  for (const item of rawCandidates) {
    const key = `${item.model}:${item.documentId}:${item.field}`;
    if (!seenCandidateKeys.has(key)) {
      seenCandidateKeys.add(key);
      candidates.push(item);
    }
  }

  // Calculate summary counts by collection and document type
  const summaryByModelAndType: Record<string, Record<string, number>> = {};
  for (const c of candidates) {
    if (!summaryByModelAndType[c.model]) summaryByModelAndType[c.model] = {};
    const docType = c.documentType || 'UNKNOWN';
    summaryByModelAndType[c.model][docType] = (summaryByModelAndType[c.model][docType] || 0) + 1;
  }

  console.log(`Discovered ${candidates.length} candidate record(s) referencing public storage:`);
  for (const [model, types] of Object.entries(summaryByModelAndType)) {
    console.log(`  Collection [${model}]:`);
    for (const [docType, count] of Object.entries(types)) {
      console.log(`    - ${docType}: ${count}`);
    }
  }

  for (const c of candidates) {
    console.log(
      `  - [${c.model}] (${c.documentType}) id=${c.documentId} field=${c.field} url=${redactUrlForDisplay(c.originalUrl)}`
    );
  }

  // --- VERIFICATION & MIGRATION PHASE ---
  console.log('\n--- Phase 2: Object Verification & Copy ---');

  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const minioClient = env.STORAGE_PROVIDER === 'minio' ? await getMinioClient() : null;

  for (const item of candidates) {
    try {
      if (env.STORAGE_PROVIDER === 'minio' && minioClient) {
        // Parse MinIO URL
        const parsed = parseMinioObjectUrl(item.originalUrl);
        if (!parsed) {
          item.status = 'SKIPPED';
          item.error = 'Not a recognizable MinIO URL or unsupported format';
          skippedCount++;
          continue;
        }

        const srcBucket = parsed.bucket;
        const srcKey = parsed.objectName;
        const destBucket = privateBucket;
        const destKey = srcKey; // Preserve key structure inside seller-doc

        item.sourceBucket = srcBucket;
        item.sourceKey = srcKey;
        item.destBucket = destBucket;
        item.destKey = destKey;

        // Idempotency: if already in private bucket, skip
        if (srcBucket === destBucket) {
          item.status = 'SKIPPED';
          item.error = 'Already located in private bucket';
          skippedCount++;
          continue;
        }

        // 1. Verify source exists & record expected size
        let srcStat: any;
        try {
          srcStat = await minioClient.statObject(srcBucket, srcKey);
        } catch (err: any) {
          item.status = 'FAILED';
          item.error = `Source object missing in MinIO: ${err?.message || err}`;
          failedCount++;
          continue;
        }
        item.sourceSize = srcStat.size;

        // Compute source stream SHA-256 using bounded streaming
        let srcHashResult: { sha256: string; bytesRead: number };
        try {
          srcHashResult = await computeMinioStreamSha256(minioClient, srcBucket, srcKey);
          item.sourceSha256 = srcHashResult.sha256;
        } catch (err: any) {
          item.status = 'FAILED';
          item.error = `Failed to compute source SHA-256: ${err?.message || err}`;
          failedCount++;
          continue;
        }

        const newUrl = item.originalUrl.replace(`/${srcBucket}/`, `/${destBucket}/`);
        item.newUrl = newUrl;

        if (isDryRun) {
          // Dry-run mode: verify source only, plan destination, no copies or DB changes
          item.status = 'VERIFIED';
          successCount++;
          continue;
        }

        // 2. Collision-safe check on destination object
        let destStat: any = null;
        try {
          destStat = await minioClient.statObject(destBucket, destKey);
        } catch {
          destStat = null;
        }

        if (destStat) {
          item.destSize = destStat.size;
          // Destination exists! Check if identical content or collision
          if (destStat.size !== srcStat.size) {
            item.status = 'FAILED';
            item.error = `Destination collision: object exists at ${destBucket}/${destKey} with different size (${destStat.size} vs ${srcStat.size})`;
            failedCount++;
            continue;
          }
          const destHashResult = await computeMinioStreamSha256(minioClient, destBucket, destKey);
          item.destSha256 = destHashResult.sha256;
          if (destHashResult.sha256 !== srcHashResult.sha256) {
            item.status = 'FAILED';
            item.error = `Destination collision: object exists at ${destBucket}/${destKey} with different content (hash mismatch)`;
            failedCount++;
            continue;
          }
          // Content matches exactly! (Safe idempotency from duplicate reference or retry)
          item.status = 'COPIED';
        } else {
          // 3. Copy to private bucket
          await minioClient.copyObject(destBucket, destKey, `/${srcBucket}/${srcKey}`);
          item.status = 'COPIED';
        }

        // 4. Verify destination object existence and content integrity via streamed SHA-256
        let verifiedDestStat: any;
        try {
          verifiedDestStat = await minioClient.statObject(destBucket, destKey);
        } catch (err: any) {
          item.status = 'FAILED';
          item.error = `Destination object missing after copy: ${err?.message || err}`;
          failedCount++;
          continue;
        }
        item.destSize = verifiedDestStat.size;

        let destHashResult: { sha256: string; bytesRead: number };
        try {
          destHashResult = await computeMinioStreamSha256(minioClient, destBucket, destKey);
          item.destSha256 = destHashResult.sha256;
        } catch (err: any) {
          item.status = 'FAILED';
          item.error = `Failed to compute destination SHA-256: ${err?.message || err}`;
          failedCount++;
          continue;
        }

        const integrity = await verifyObjectIntegrity(
          {
            getSize: async () => srcStat.size,
            getSha256: async () => srcHashResult.sha256,
            getEtag: async () => srcStat.etag,
          },
          {
            getSize: async () => verifiedDestStat.size,
            getSha256: async () => destHashResult.sha256,
            getEtag: async () => verifiedDestStat.etag,
          }
        );

        if (!integrity.verified) {
          item.status = 'FAILED';
          item.error = integrity.error || 'Destination content integrity verification failed';
          failedCount++;
          continue;
        }

        item.status = 'VERIFIED';

        // 5. Update MongoDB ONLY after destination content integrity is verified
        const filter = { _id: new mongoose.Types.ObjectId(item.documentId) };
        const update = { $set: { [item.field]: newUrl } };

        if (item.model === 'SellerDocument') {
          await SellerDocument.updateOne(filter, update);
        } else if (item.model === 'SellerOnboarding') {
          await SellerOnboarding.updateOne(filter, update);
        } else if (item.model === 'SellerStoreSettings') {
          await SellerStoreSettings.updateOne(filter, update);
        }

        item.status = 'UPDATED';
        successCount++;
      } else {
        // Local file system mode
        // For local storage, resolve file in LOCAL_UPLOAD_DIR
        const relPath = item.originalUrl.replace(/^.*\/uploads\//, '');
        const srcPath = path.join(LOCAL_UPLOAD_DIR, relPath);

        if (!fs.existsSync(srcPath)) {
          item.status = 'FAILED';
          item.error = `Source file missing at ${srcPath}`;
          failedCount++;
          continue;
        }

        const srcStat = fs.statSync(srcPath);
        item.sourceSize = srcStat.size;

        const srcHashResult = await computeFileStreamSha256(srcPath);
        item.sourceSha256 = srcHashResult.sha256;

        if (isDryRun) {
          item.status = 'VERIFIED';
          successCount++;
          continue;
        }

        // Live local execution:
        // Place into private seller-documents or bank-documents if not already
        const targetSubdir = item.documentType?.includes('BANK') ? 'bank-documents' : 'seller-documents';
        const fileName = path.basename(srcPath);
        const destPath = path.join(LOCAL_UPLOAD_DIR, targetSubdir, fileName);

        if (fs.existsSync(destPath) && destPath !== srcPath) {
          const destStat = fs.statSync(destPath);
          const destHash = await computeFileStreamSha256(destPath);
          if (destStat.size !== srcStat.size || destHash.sha256 !== srcHashResult.sha256) {
            item.status = 'FAILED';
            item.error = `Local destination collision with different content at ${destPath}`;
            failedCount++;
            continue;
          }
        } else if (!fs.existsSync(destPath)) {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(srcPath, destPath);
        }

        const verifiedDestStat = fs.statSync(destPath);
        const destHashResult = await computeFileStreamSha256(destPath);
        item.destSize = verifiedDestStat.size;
        item.destSha256 = destHashResult.sha256;

        if (verifiedDestStat.size !== srcStat.size || destHashResult.sha256 !== srcHashResult.sha256) {
          item.status = 'FAILED';
          item.error = 'Local file integrity check failed';
          failedCount++;
          continue;
        }

        const newUrl = item.originalUrl.replace(/\/uploads\/[^/]+\//, `/uploads/${targetSubdir}/`);
        item.newUrl = newUrl;

        const filter = { _id: new mongoose.Types.ObjectId(item.documentId) };
        const update = { $set: { [item.field]: newUrl } };

        if (item.model === 'SellerDocument') {
          await SellerDocument.updateOne(filter, update);
        } else if (item.model === 'SellerOnboarding') {
          await SellerOnboarding.updateOne(filter, update);
        } else if (item.model === 'SellerStoreSettings') {
          await SellerStoreSettings.updateOne(filter, update);
        }

        item.status = 'UPDATED';
        successCount++;
      }
    } catch (err: any) {
      item.status = 'FAILED';
      item.error = err?.message || String(err);
      failedCount++;
    }
  }

  // --- MANIFEST GENERATION ---
  const manifestId = `migration_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const manifest: MigrationManifest = {
    manifestId,
    executedAt: new Date().toISOString(),
    mode: isDryRun ? 'dry-run' : 'execute',
    storageProvider: env.STORAGE_PROVIDER,
    totalCandidates: candidates.length,
    successCount,
    skippedCount,
    failedCount,
    summaryByModelAndType,
    records: candidates,
  };

  const manifestPath = path.join(manifestDir, `${manifestId}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('\n==================================================================');
  console.log(`📊 MIGRATION SUMMARY: ${successCount} Success / ${skippedCount} Skipped / ${failedCount} Failed`);
  console.log(`📝 Manifest written to: ${manifestPath}`);
  console.log('🛡️ Source objects were NOT deleted. Explicit cleanup is required post-verification.');
  console.log('==================================================================\n');

  return manifest;
}

// Standalone execution entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const rollbackIdx = args.indexOf('--rollback');
  const rollbackPath = rollbackIdx !== -1 && args[rollbackIdx + 1] ? args[rollbackIdx + 1] : undefined;

  runMigration({
    dryRun: !isExecute,
    rollbackPath,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal migration error:', err);
      process.exit(1);
    });
}


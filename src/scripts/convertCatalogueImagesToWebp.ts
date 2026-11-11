import '../models/register';
import fs from 'fs/promises';
import path from 'path';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductImage from '../models/ProductImage';
import CustomerOrder from '../models/CustomerOrder';
import {
  getMinioClient,
  LOCAL_UPLOAD_DIR,
  parseMinioObjectUrl,
  uploadBufferToStorage,
} from '../utils/storage';
import { getPublicApiBase } from '../utils/media';
import { convertQcImageToWebp } from '../utils/qcImageProcessing';

type ImageReference = {
  collection: 'category' | 'subcategory' | 'product-image' | 'order-item';
  documentId?: string;
  url: string;
};

type ManagedImage = {
  subdir: 'categories' | 'subcategories' | 'products';
  read: () => Promise<Buffer>;
};

const CATALOGUE_SUBDIRS = new Set(['categories', 'subcategories', 'products']);
const execute = process.argv.includes('--execute');

function isUnsplashImage(url: string): boolean {
  try {
    return new URL(url).hostname === 'images.unsplash.com';
  } catch {
    return false;
  }
}

function toUnsplashWebpUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('auto');
  parsed.searchParams.set('fm', 'webp');
  return parsed.toString();
}

function getLocalManagedImage(url: string): ManagedImage | null {
  try {
    const base = new URL(getPublicApiBase());
    const parsed = new URL(url, base);
    if (parsed.origin !== base.origin || !parsed.pathname.startsWith('/uploads/')) {
      return null;
    }

    const segments = decodeURIComponent(parsed.pathname)
      .split('/')
      .filter(Boolean);
    const [uploads, subdir, ...fileParts] = segments;
    if (
      uploads !== 'uploads' ||
      !CATALOGUE_SUBDIRS.has(subdir) ||
      fileParts.length === 0
    ) {
      return null;
    }

    const absolutePath = path.resolve(LOCAL_UPLOAD_DIR, subdir, ...fileParts);
    const relativePath = path.relative(LOCAL_UPLOAD_DIR, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return null;
    }

    return {
      subdir: subdir as ManagedImage['subdir'],
      read: () => fs.readFile(absolutePath),
    };
  } catch {
    return null;
  }
}

async function readMinioObject(bucket: string, objectName: string): Promise<Buffer> {
  const client = await getMinioClient();
  const stream = await client.getObject(bucket, objectName);
  const chunks: Buffer[] = [];

  return new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function getManagedImage(url: string): ManagedImage | null {
  const minioObject = parseMinioObjectUrl(url);
  if (minioObject) {
    const [subdir, ...keyParts] = minioObject.objectName.split('/');
    if (!CATALOGUE_SUBDIRS.has(subdir) || keyParts.length === 0) return null;

    return {
      subdir: subdir as ManagedImage['subdir'],
      read: () => readMinioObject(minioObject.bucket, minioObject.objectName),
    };
  }
  return getLocalManagedImage(url);
}

function isWebpUrl(url: string): boolean {
  try {
    return /\.webp$/i.test(new URL(url).pathname);
  } catch {
    return /\.webp(?:$|\?)/i.test(url);
  }
}

async function loadReferences(): Promise<ImageReference[]> {
  const [categories, subcategories, productImages, orderImageUrls] = await Promise.all([
    Category.find({ imageUrl: { $type: 'string', $ne: '' } }).select('_id imageUrl').lean(),
    Subcategory.find({ imageUrl: { $type: 'string', $ne: '' } }).select('_id imageUrl').lean(),
    ProductImage.find({ imageUrl: { $type: 'string', $ne: '' } }).select('_id imageUrl').lean(),
    CustomerOrder.distinct('items.imageUrl', {
      'items.imageUrl': { $type: 'string', $ne: '' },
    }),
  ]);

  return [
    ...categories.map((item) => ({
      collection: 'category' as const,
      documentId: String(item._id),
      url: item.imageUrl || '',
    })),
    ...subcategories.map((item) => ({
      collection: 'subcategory' as const,
      documentId: String(item._id),
      url: item.imageUrl || '',
    })),
    ...productImages.map((item) => ({
      collection: 'product-image' as const,
      documentId: String(item._id),
      url: item.imageUrl,
    })),
    ...orderImageUrls
      .filter((url): url is string => typeof url === 'string' && Boolean(url.trim()))
      .map((url) => ({ collection: 'order-item' as const, url })),
  ].filter((reference) => Boolean(reference.url));
}

async function updateReference(
  reference: ImageReference,
  previousUrl: string,
  nextUrl: string,
  fileSize?: number,
): Promise<number> {
  if (reference.collection === 'category') {
    const result = await Category.updateOne(
      { _id: reference.documentId, imageUrl: previousUrl },
      { $set: { imageUrl: nextUrl } },
    );
    return result.modifiedCount;
  }
  if (reference.collection === 'subcategory') {
    const result = await Subcategory.updateOne(
      { _id: reference.documentId, imageUrl: previousUrl },
      { $set: { imageUrl: nextUrl } },
    );
    return result.modifiedCount;
  }
  if (reference.collection === 'product-image') {
    const result = await ProductImage.updateOne(
      { _id: reference.documentId, imageUrl: previousUrl },
      {
        $set: {
          imageUrl: nextUrl,
          mimeType: 'image/webp',
          ...(fileSize === undefined ? {} : { fileSize }),
        },
      },
    );
    return result.modifiedCount;
  }

  const result = await CustomerOrder.updateMany(
    { 'items.imageUrl': previousUrl },
    { $set: { 'items.$[item].imageUrl': nextUrl } },
    { arrayFilters: [{ 'item.imageUrl': previousUrl }] },
  );
  return result.modifiedCount;
}

async function migrate(): Promise<void> {
  await connectDatabase();

  try {
    const references = await loadReferences();
    const referencesByUrl = new Map<string, ImageReference[]>();
    for (const reference of references) {
      const current = referencesByUrl.get(reference.url) || [];
      current.push(reference);
      referencesByUrl.set(reference.url, current);
    }

    const uniqueUrls = [...referencesByUrl.keys()];
    const managedCount = uniqueUrls.filter((url) => getManagedImage(url)).length;
    const unsplashCount = uniqueUrls.filter(isUnsplashImage).length;
    const webpCount = uniqueUrls.filter(isWebpUrl).length;
    const unsupportedUrls = uniqueUrls.filter(
      (url) => !isUnsplashImage(url) && !isWebpUrl(url) && !getManagedImage(url),
    );

    console.log(
      JSON.stringify(
        {
          mode: execute ? 'execute' : 'dry-run',
          references: references.length,
          uniqueImageUrls: uniqueUrls.length,
          managedUploads: managedCount,
          unsplashUrls: unsplashCount,
          alreadyWebp: webpCount,
          unsupportedExternalUrls: unsupportedUrls.length,
          unsupportedUrlSamples: unsupportedUrls.slice(0, 10),
        },
        null,
        2,
      ),
    );

    if (!execute) {
      console.log('Dry run only. Re-run with --execute to create WebP files and update catalog references.');
      return;
    }

    let updated = 0;
    let failed = 0;
    for (const url of uniqueUrls) {
      if (isWebpUrl(url)) continue;

      try {
        let nextUrl: string;
        let fileSize: number | undefined;
        if (isUnsplashImage(url)) {
          nextUrl = toUnsplashWebpUrl(url);
        } else {
          const managed = getManagedImage(url);
          if (!managed) {
            console.warn(`Skipped unsupported external image URL: ${url}`);
            continue;
          }

          const sourceBuffer = await managed.read();
          const webpBuffer = await convertQcImageToWebp(sourceBuffer);
          const output = await uploadBufferToStorage(
            webpBuffer,
            `${path.parse(new URL(url, getPublicApiBase()).pathname).name || 'image'}.webp`,
            'image/webp',
            managed.subdir,
          );
          nextUrl = output.url;
          fileSize = webpBuffer.length;
        }

        for (const reference of referencesByUrl.get(url) || []) {
          updated += await updateReference(reference, url, nextUrl, fileSize);
        }
      } catch (error) {
        failed += 1;
        console.error(`Failed to migrate image URL: ${url}`, error);
      }
    }

    console.log(JSON.stringify({ updatedReferences: updated, failures: failed }, null, 2));
    if (failed > 0) {
      throw new Error(`WebP migration failed for ${failed} image URL(s).`);
    }
  } finally {
    await disconnectDatabase();
  }
}

migrate().catch((error) => {
  console.error('ExtraMart WebP migration failed.', error);
  process.exitCode = 1;
});

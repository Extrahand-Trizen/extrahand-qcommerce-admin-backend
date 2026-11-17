import path from 'path';
import sharp from 'sharp';
import type { Express } from 'express';
import { uploadBufferToStorage, type UploadResult } from './storage';

const MAX_IMAGE_DIMENSION = 1200;
const THUMBNAIL_DIMENSION = 160;
const WEBP_QUALITY = 80;
const THUMB_QUALITY = 75;

export async function convertQcImageToWebp(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: 'error' })
    .rotate()
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer();
}

export async function generateThumbnailWebp(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: 'error' })
    .rotate()
    .resize({
      width: THUMBNAIL_DIMENSION,
      height: THUMBNAIL_DIMENSION,
      fit: 'cover',
      position: 'center',
    })
    .webp({ quality: THUMB_QUALITY, effort: 4 })
    .toBuffer();
}

export async function uploadQcImage(
  file: Express.Multer.File,
  subdir: 'categories' | 'subcategories' | 'products' | 'product-requests' | 'shop-images',
): Promise<UploadResult> {
  const [webpBuffer, thumbBuffer] = await Promise.all([
    convertQcImageToWebp(file.buffer),
    generateThumbnailWebp(file.buffer),
  ]);
  const originalName = path.parse(file.originalname).name || 'image';

  const [mainResult, thumbResult] = await Promise.all([
    uploadBufferToStorage(
      webpBuffer,
      `${originalName}.webp`,
      'image/webp',
      subdir,
    ),
    uploadBufferToStorage(
      thumbBuffer,
      `${originalName}_thumb.webp`,
      'image/webp',
      subdir,
    ),
  ]);

  return {
    ...mainResult,
    thumbnailUrl: thumbResult.url,
  };
}

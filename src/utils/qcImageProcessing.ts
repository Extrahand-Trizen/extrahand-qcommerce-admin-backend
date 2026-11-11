import path from 'path';
import sharp from 'sharp';
import type { Express } from 'express';
import { uploadBufferToStorage, type UploadResult } from './storage';

const MAX_IMAGE_DIMENSION = 1600;
const WEBP_QUALITY = 80;

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

export async function uploadQcImage(
  file: Express.Multer.File,
  subdir: 'categories' | 'subcategories' | 'products',
): Promise<UploadResult> {
  const webpBuffer = await convertQcImageToWebp(file.buffer);
  const originalName = path.parse(file.originalname).name || 'image';

  return uploadBufferToStorage(
    webpBuffer,
    `${originalName}.webp`,
    'image/webp',
    subdir,
  );
}

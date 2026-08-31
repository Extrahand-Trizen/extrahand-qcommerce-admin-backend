import multer from 'multer';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_DOC_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_DOC_SIZE = 10 * 1024 * 1024;

const storage = multer.memoryStorage();

export const uploadImage = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
  },
});

export const uploadDocument = multer({
  storage,
  limits: { fileSize: MAX_DOC_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOC_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, and PDF files are allowed'));
  },
});

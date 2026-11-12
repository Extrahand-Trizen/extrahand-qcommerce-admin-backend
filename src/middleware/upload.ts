import multer from 'multer';

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/octet-stream',
];
const ALLOWED_DOC_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'application/octet-stream',
];
const MAX_IMAGE_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_DOC_SIZE = 25 * 1024 * 1024;

const storage = multer.memoryStorage();

export const uploadImage = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const name = (file.originalname || '').toLowerCase();
    if (
      ALLOWED_IMAGE_TYPES.includes(mime) ||
      mime.startsWith('image/') ||
      /\.(jpe?g|png|webp|heic|heif)$/i.test(name)
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP, HEIC) are allowed'));
    }
  },
});

export const uploadDocument = multer({
  storage,
  limits: { fileSize: MAX_DOC_SIZE },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const name = (file.originalname || '').toLowerCase();
    if (
      ALLOWED_DOC_TYPES.includes(mime) ||
      mime.startsWith('image/') ||
      mime === 'application/pdf' ||
      /\.(jpe?g|png|webp|heic|pdf)$/i.test(name)
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP, PDF) are allowed'));
    }
  },
});

const ALLOWED_SPREADSHEET_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'text/csv',
  'text/plain',
];

export const uploadSpreadsheet = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const name = (file.originalname || '').toLowerCase();
    if (
      ALLOWED_SPREADSHEET_TYPES.includes(mime) ||
      /\.(xlsx|xls|csv)$/i.test(name)
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) and CSV (.csv) files are allowed'));
    }
  },
});


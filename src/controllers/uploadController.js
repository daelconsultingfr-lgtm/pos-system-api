const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const logger = require('../../config/logger');

// Dossier racine des factures : <project_root>/src/invoices
const INVOICES_ROOT = path.join(__dirname, '..', '..', 'src', 'invoices');

// ─── BUG CORRIGÉ : new Date("2026-03-08") est parsé en UTC → en Europe = 2026-03-07
// parseLocalDate("2026-03-08") → new Date(2026, 2, 8) → heure locale correcte
function parseLocalDate(str) {
  if (!str) return new Date();
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const date  = req.body?.date ? parseLocalDate(req.body.date) : new Date();
    const year  = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dir   = path.join(INVOICES_ROOT, year, month);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext      = path.extname(file.originalname).toLowerCase();
    const basename = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    const unique = `${Date.now()}_${basename}${ext}`;
    cb(null, unique);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    logger.error('File type not allowed', { mimetype: file.mimetype });
    cb(new Error('Type de fichier non autorisé (JPEG, PNG, WEBP, HEIC, PDF uniquement)'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 Mo max
});

// ─── POST /api/v1/upload/receipt ──────────────────────────────────────────────
const uploadReceipt = [
  upload.single('file'),
  (req, res) => {
    if (!req.file) {
      logger.error('No file received');
      return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
    }

    // BUG CORRIGÉ : utiliser parseLocalDate ici aussi pour la cohérence
    const date  = req.body?.date ? parseLocalDate(req.body.date) : new Date();
    const year  = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const url   = `/invoices/${year}/${month}/${req.file.filename}`;

    logger.info('File uploaded', { url });
    return res.json({ success: true, data: { url } });
  },
];

// ─── Middleware de gestion d'erreur multer ────────────────────────────────────
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      logger.error('File too large');
      return res.status(413).json({ success: false, message: 'Fichier trop volumineux (max 15 Mo)' });
    }
    logger.error('Multer error', { message: err.message });
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) {
    logger.error('Upload error', { message: err.message });
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
};

// ─── Suppression physique d'un fichier facture ────────────────────────────────
function deleteReceiptFile(receiptUrl) {
  if (!receiptUrl) return;
  const relative = receiptUrl.replace(/^\/invoices\//, '');
  const fullPath  = path.join(INVOICES_ROOT, relative);
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      logger.info('Receipt file deleted', { path: fullPath });
    }
  } catch (err) {
    logger.error('Error while deleting receipt file', { message: err.message, path: fullPath });
  }
}

module.exports = { uploadReceipt, handleUploadError, deleteReceiptFile };

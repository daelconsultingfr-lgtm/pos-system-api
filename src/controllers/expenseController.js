const pool   = require('../../config/database');
const logger = require('../../config/logger');
const upload = require('./uploadController');
const { body, param, query, validationResult } = require('express-validator');

const MAX_LIMIT = 500;
const CATEGORIES = ['Matériel', 'Loyer', 'Stock', 'Salaires', 'Services', 'Autre'];

// ─── Middleware de vérification ───────────────────────────────────────────────
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ─── Règles de validation ─────────────────────────────────────────────────────
const getAllRules = [
  query('from').optional().isISO8601().withMessage('Date "from" invalide (format YYYY-MM-DD)'),
  query('to').optional().isISO8601().withMessage('Date "to" invalide (format YYYY-MM-DD)'),
  query('category').optional().isIn(CATEGORIES).withMessage('Catégorie invalide'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page invalide').toInt(),
  query('limit').optional().isInt({ min: 1, max: MAX_LIMIT }).withMessage(`Limite invalide (max ${MAX_LIMIT})`).toInt(),
];

const createRules = [
  body('label')
    .trim()
    .notEmpty().withMessage('Description requise')
    .isLength({ max: 255 }).withMessage('Description trop longue (max 255 caractères)'),
  body('amount')
    .isFloat({ min: 0 }).withMessage('Montant invalide (nombre positif requis)'),
  body('category')
    .optional({ checkFalsy: true })
    .isIn(CATEGORIES).withMessage('Catégorie invalide'),
  body('date')
    .optional({ checkFalsy: true })
    .isISO8601().withMessage('Date invalide (format YYYY-MM-DD)'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Notes trop longues (max 500 caractères)'),
  body('receipt_url')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 }).withMessage('URL justificatif trop longue'),
];

const updateRules = [
  param('id').isInt({ min: 1 }).withMessage('ID invalide'),
  body('label')
    .trim()
    .notEmpty().withMessage('Description requise')
    .isLength({ max: 255 }).withMessage('Description trop longue (max 255 caractères)'),
  body('amount')
    .isFloat({ min: 0 }).withMessage('Montant invalide'),
  body('category')
    .optional({ checkFalsy: true })
    .isIn(CATEGORIES).withMessage('Catégorie invalide'),
  body('date')
    .optional({ checkFalsy: true })
    .isISO8601().withMessage('Date invalide (format YYYY-MM-DD)'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Notes trop longues (max 500 caractères)'),
  body('receipt_url')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 }).withMessage('URL justificatif trop longue'),
];

// ─── GET /expenses ────────────────────────────────────────────────────────────
const getAll = async (req, res) => {
  try {
    const { from, to, category, page = 1, limit = 50 } = req.query;
    const safeLimit = Math.min(parseInt(limit), MAX_LIMIT);
    const params = [];
    const where  = [];

    if (from)     { params.push(from);     where.push(`date >= $${params.length}`); }
    if (to)       { params.push(to);       where.push(`date <= $${params.length}`); }
    if (category) { params.push(category); where.push(`category = $${params.length}`); }

    const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM expenses ${whereSQL}`, params);
    const offset = (page - 1) * safeLimit;
    params.push(safeLimit, offset);

    const result = await pool.query(
      `SELECT * FROM expenses ${whereSQL} ORDER BY date DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    logger.info('Expenses found', { expensesFound: parseInt(countResult.rows[0].count) });
    res.json({
      success: true,
      data: result.rows,
      pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: safeLimit },
    });
  } catch (err) {
    logger.error('Error while retrieving expenses', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /expenses ───────────────────────────────────────────────────────────
const create = async (req, res) => {
  try {
    const { label, amount, category, date, notes, receipt_url } = req.body;
    const result = await pool.query(
      `INSERT INTO expenses (label, amount, category, date, notes, receipt_url, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        label,
        parseFloat(amount),
        category || null,
        date || new Date().toISOString().split('T')[0],
        notes || null,
        receipt_url || null,
        req.user.id,
      ]
    );
    logger.info('Expense created', { expenseId: result.rows[0].id });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while creating expense', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /expenses/:id ────────────────────────────────────────────────────────
// BUG CORRIGÉ : logger.error était placé après res.json (hors try/catch),
// et faisait référence à "err" qui n'existait pas dans ce scope
const update = async (req, res) => {
  try {
    const { label, amount, category, date, notes, receipt_url } = req.body;
    const result = await pool.query(
      `UPDATE expenses
       SET label=$1, amount=$2, category=$3, date=$4, notes=$5, receipt_url=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [label, parseFloat(amount), category || null, date, notes || null, receipt_url || null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Dépense introuvable' });
    logger.info('Expense updated', { expenseId: result.rows[0].id });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while updating expense', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DELETE /expenses/:id ─────────────────────────────────────────────────────
const remove = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT receipt_url FROM expenses WHERE id=$1', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Dépense introuvable' });

    if (rows[0].receipt_url) upload.deleteReceiptFile(rows[0].receipt_url);

    await pool.query('DELETE FROM expenses WHERE id=$1', [req.params.id]);
    logger.info('Expense deleted', { expenseId: req.params.id, by: req.user.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('Error while deleting expense', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getAllRules, createRules, updateRules, validate, getAll, create, update, remove };

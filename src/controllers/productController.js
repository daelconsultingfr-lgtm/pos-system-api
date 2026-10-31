const pool   = require('../../config/database');
const logger = require('../../config/logger');
const { body, param, query, validationResult } = require('express-validator');

const MAX_LIMIT = 500;

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
  query('search').optional().trim().isLength({ max: 100 }).withMessage('Recherche trop longue'),
  query('category_id').optional().isInt({ min: 1 }).withMessage('category_id invalide'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page invalide').toInt(),
  query('limit').optional().isInt({ min: 1, max: MAX_LIMIT }).withMessage(`Limite invalide (max ${MAX_LIMIT})`).toInt(),
];

const createRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Nom requis')
    .isLength({ max: 200 }).withMessage('Nom trop long (max 200 caractères)'),
  body('price')
    .isFloat({ min: 0 }).withMessage('Prix invalide (nombre positif requis)'),
  body('category_id')
    .optional({ checkFalsy: true })
    .isInt({ min: 1 }).withMessage('Catégorie invalide'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 }).withMessage('Description trop longue (max 1000 caractères)'),
  body('duration')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('Durée trop longue'),
  body('tax_rate')
    .optional()
    .isFloat({ min: 0, max: 100 }).withMessage('Taux TVA invalide (0-100)'),
];

const updateRules = [
  param('id').isInt({ min: 1 }).withMessage('ID invalide'),
  ...createRules,
  body('is_active')
    .optional()
    .isBoolean().withMessage('is_active doit être true ou false'),
];

// ─── GET /products ────────────────────────────────────────────────────────────
const getAll = async (req, res) => {
  try {
    const { search, category_id, active = true, page = 1, limit = 50 } = req.query;
    const safeLimit = Math.min(parseInt(limit), MAX_LIMIT);
    const offset = (page - 1) * safeLimit;
    const params = [];
    const where  = ['p.is_active = $1'];
    params.push(active === 'false' ? false : true);

    if (search) {
      params.push(`%${search}%`);
      where.push(`(p.name ILIKE $${params.length} OR p.barcode ILIKE $${params.length})`);
    }
    if (category_id) {
      params.push(category_id);
      where.push(`p.category_id = $${params.length}`);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM products p WHERE ${where.join(' AND ')}`, params
    );

    params.push(safeLimit, offset);
    const result = await pool.query(
      `SELECT p.*, c.name AS category_name, c.color AS category_color
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE ${where.join(' AND ')}
       ORDER BY c.name, p.name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    logger.info('Products found', { productsFound: parseInt(countResult.rows[0].count) });
    res.json({
      success: true,
      data: result.rows,
      pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: safeLimit },
    });
  } catch (err) {
    logger.error('Error while retrieving products', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /products/barcode/:barcode ───────────────────────────────────────────
const getByBarcode = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name AS category_name FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.barcode = $1 AND p.is_active = true`,
      [req.params.barcode]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Produit introuvable' });
    logger.info('Product found by barcode', { barcode: req.params.barcode });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while retrieving product by barcode', { message: err.message, barcode: req.params.barcode });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /products/:id ────────────────────────────────────────────────────────
const getOne = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name AS category_name FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Produit introuvable' });
    logger.info('Product found', { productId: req.params.id });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while retrieving product', { message: err.message, productId: req.params.id });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /products ───────────────────────────────────────────────────────────
const create = async (req, res) => {
  try {
    const { category_id, name, description, duration, price, tax_rate = 20 } = req.body;
    const result = await pool.query(
      `INSERT INTO products (category_id, name, description, duration, price, tax_rate)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [category_id || null, name, description || null, duration || null, price, tax_rate]
    );
    logger.info('Product created', { productId: result.rows[0].id });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while creating product', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /products/:id ────────────────────────────────────────────────────────
const update = async (req, res) => {
  try {
    const { category_id, name, description, duration, price, tax_rate, is_active } = req.body;
    const result = await pool.query(
      `UPDATE products SET category_id=$1, name=$2, description=$3, duration=$4, price=$5,
       tax_rate=$6, is_active=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [category_id || null, name, description || null, duration || null,
       price, tax_rate, is_active ?? true, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Produit introuvable' });
    logger.info('Product updated', { productId: result.rows[0].id });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while updating product', { message: err.message, productId: req.params.id });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DELETE /products/:id (soft delete) ──────────────────────────────────────
// BUG CORRIGÉ : "DELETE products SET…" → syntaxe SQL invalide, doit être "UPDATE products SET…"
const remove = async (req, res) => {
  try {
    await pool.query('UPDATE products SET is_active = false, updated_at = NOW() WHERE id = $1', [req.params.id]);
    logger.info('Product deactivated', { productId: req.params.id });
    res.json({ success: true, message: 'Produit désactivé' });
  } catch (err) {
    logger.error('Error while deactivating product', { message: err.message, productId: req.params.id });
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getAllRules, createRules, updateRules, validate, getAll, getOne, getByBarcode, create, update, remove };

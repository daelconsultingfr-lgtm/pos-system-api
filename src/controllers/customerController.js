const pool   = require('../../config/database');
const logger = require('../../config/logger');
const { body, param, query, validationResult } = require('express-validator');

const MAX_LIMIT = 200;

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
  query('page').optional().isInt({ min: 1 }).withMessage('Page invalide').toInt(),
  query('limit').optional().isInt({ min: 1, max: MAX_LIMIT }).withMessage(`Limite invalide (max ${MAX_LIMIT})`).toInt(),
];

const createRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Nom requis')
    .isLength({ max: 150 }).withMessage('Nom trop long (max 150 caractères)'),
  body('email')
    .optional({ checkFalsy: true })
    .trim()
    .isEmail().withMessage('Email invalide')
    .normalizeEmail(),
  body('phone')
    .optional()
    .trim()
    .isLength({ max: 30 }).withMessage('Téléphone trop long'),
  body('address')
    .optional()
    .trim()
    .isLength({ max: 300 }).withMessage('Adresse trop longue'),
];

const updateRules = [
  param('id').isInt({ min: 1 }).withMessage('ID invalide'),
  ...createRules,
];

// ─── GET /customers ───────────────────────────────────────────────────────────
const getAll = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const safeLimit = Math.min(parseInt(limit), MAX_LIMIT);
    const params = [];
    let where = '';

    if (search) {
      params.push(`%${search}%`);
      where = `WHERE name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1`;
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM customers ${where}`, params);
    const offset = (page - 1) * safeLimit;
    params.push(safeLimit, offset);

    const result = await pool.query(
      `SELECT * FROM customers ${where} ORDER BY name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    logger.info('Customers found', { total: parseInt(countResult.rows[0].count) });
    res.json({
      success: true,
      data: result.rows,
      pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: safeLimit },
    });
  } catch (err) {
    logger.error('Error while retrieving customers', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /customers/:id ───────────────────────────────────────────────────────
const getOne = async (req, res) => {
  try {
    const customer = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (!customer.rows[0]) return res.status(404).json({ success: false, message: 'Client introuvable' });

    const orders = await pool.query(
      `SELECT id, order_number, total, status, created_at
       FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [req.params.id]
    );

    logger.info('Customer found', { name: customer.rows[0].name });
    res.json({ success: true, data: { ...customer.rows[0], recent_orders: orders.rows } });
  } catch (err) {
    logger.error('Error while retrieving customer', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /customers ──────────────────────────────────────────────────────────
const create = async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;
    const result = await pool.query(
      'INSERT INTO customers (name, email, phone, address) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, email || null, phone || null, address || null]
    );
    logger.info('Customer created', { customerId: result.rows[0].id });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while creating customer', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /customers/:id ───────────────────────────────────────────────────────
const update = async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;
    const result = await pool.query(
      `UPDATE customers SET name=$1, email=$2, phone=$3, address=$4, updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [name, email || null, phone || null, address || null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Client introuvable' });
    logger.info('Customer updated', { customerId: result.rows[0].id });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while updating customer', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getAllRules, createRules, updateRules, validate, getAll, getOne, create, update };

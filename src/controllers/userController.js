const pool   = require('../../config/database');
const bcrypt = require('bcryptjs');
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
    .isLength({ max: 100 }).withMessage('Nom trop long (max 100 caractères)'),
  body('email')
    .trim()
    .isEmail().withMessage('Email invalide')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Mot de passe minimum 8 caractères'),
  body('is_active')
    .optional()
    .isBoolean().withMessage('is_active doit être true ou false'),
];

const updateRules = [
  param('id').isInt({ min: 1 }).withMessage('ID invalide'),
  body('name')
    .optional()
    .trim()
    .notEmpty().withMessage('Nom requis')
    .isLength({ max: 100 }).withMessage('Nom trop long'),
  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Email invalide')
    .normalizeEmail(),
  body('password')
    .optional({ checkFalsy: true })
    .isLength({ min: 8 }).withMessage('Mot de passe minimum 8 caractères'),
  body('is_active')
    .optional()
    .isBoolean().withMessage('is_active doit être true ou false'),
];

// ─── GET /users ───────────────────────────────────────────────────────────────
const getAll = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const safeLimit = Math.min(parseInt(limit), MAX_LIMIT);
    const params = [];
    let where = '';

    if (search) {
      params.push(`%${search}%`);
      where = `WHERE name ILIKE $1 OR email ILIKE $1`;
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM users ${where}`, params);
    const offset = (page - 1) * safeLimit;
    params.push(safeLimit, offset);

    const result = await pool.query(
      // BUG CORRIGÉ : ne jamais retourner le champ password
      `SELECT id, name, email, role, color, is_active, created_at FROM users ${where}
       ORDER BY name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    logger.info('Users found', { usersFound: parseInt(countResult.rows[0].count) });
    res.json({
      success: true,
      data: result.rows,
      pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: safeLimit },
    });
  } catch (err) {
    logger.error('Error while retrieving users', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /users/:id ───────────────────────────────────────────────────────────
// BUG CORRIGÉ : "orders" n'était pas défini, provoquant un crash à l'exécution
const getOne = async (req, res) => {
  try {
    const result = await pool.query(
      // BUG CORRIGÉ : ne jamais retourner le champ password
      'SELECT id, name, email, role, color, is_active, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

    logger.info('User found', { userId: req.params.id });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while retrieving user', { message: err.message, userId: req.params.id });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /users ──────────────────────────────────────────────────────────────
// BUG CORRIGÉ : utilisait "phone, address" au lieu de "password, is_active"
const create = async (req, res) => {
  try {
    const { name, email, password, is_active = true } = req.body;
    const hashed = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, password, is_active)
       VALUES ($1,$2,$3,$4) RETURNING id, name, email, role, is_active, created_at`,
      [name, email, hashed, is_active]
    );
    logger.info('User created', { userId: result.rows[0].id });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while creating user', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /users/:id ───────────────────────────────────────────────────────────
// BUG CORRIGÉ : utilisait "phone, address" au lieu de "password, is_active"
const update = async (req, res) => {
  try {
    const { name, email, password, is_active } = req.body;
    let sql, params;

    if (password && password.trim() !== '') {
      const hashed = await bcrypt.hash(password, 12);
      sql    = `UPDATE users SET name=$1, email=$2, password=$3, is_active=$4, updated_at=NOW()
                WHERE id=$5 RETURNING id, name, email, role, is_active`;
      params = [name, email, hashed, is_active ?? true, req.params.id];
    } else {
      sql    = `UPDATE users SET name=$1, email=$2, is_active=$3, updated_at=NOW()
                WHERE id=$4 RETURNING id, name, email, role, is_active`;
      params = [name, email, is_active ?? true, req.params.id];
    }

    const result = await pool.query(sql, params);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    logger.info('User updated', { userId: result.rows[0].id });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while updating user', { message: err.message, userId: req.params.id });
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getAllRules, createRules, updateRules, validate, getAll, getOne, create, update };

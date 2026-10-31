const pool   = require('../../config/database');
const bcrypt = require('bcryptjs');
const logger = require('../../config/logger');
const { body, param, query, validationResult } = require('express-validator');

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
];

const updateRules = [
  param('id').isInt({ min: 1 }).withMessage('ID invalide'),
  body('name')
    .trim()
    .notEmpty().withMessage('Nom requis')
    .isLength({ max: 100 }).withMessage('Nom trop long (max 100 caractères)'),
  body('email')
    .trim()
    .isEmail().withMessage('Email invalide')
    .normalizeEmail(),
  body('role')
    .isIn(['admin', 'manager', 'cashier']).withMessage('Rôle invalide'),
  body('color')
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Couleur invalide (format #RRGGBB attendu)'),
  body('password')
    .optional({ checkFalsy: true })
    .isLength({ min: 8 }).withMessage('Mot de passe minimum 8 caractères'),
];

// ─── GET /employees ───────────────────────────────────────────────────────────
const getAll = async (req, res) => {
  try {
    const { search } = req.query;
    let sql = 'SELECT id, name, email, role, color, is_active, created_at FROM users WHERE is_active = true';
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (name ILIKE $1 OR role ILIKE $1)`;
    }
    sql += ' ORDER BY name';
    const result = await pool.query(sql, params);
    logger.info('Employees found', { numberOfEmployees: result.rows.length });
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('Error while retrieving employees', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /employees/:id ───────────────────────────────────────────────────────
const getOne = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, color, is_active, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Employé introuvable' });
    logger.info('Employee found', { name: result.rows[0].name });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while retrieving employee', { message: err.message, userId: req.user.id });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /employees/:id ───────────────────────────────────────────────────────
const update = async (req, res) => {
  try {
    const { name, email, password, role, color } = req.body;
    let sql, params;

    if (password && password.trim() !== '') {
      const hashed = await bcrypt.hash(password, 12);
      sql    = `UPDATE users SET name=$1, email=$2, password=$3, role=$4, color=$5, updated_at=NOW()
                WHERE id=$6 RETURNING id, name, email, role, color, is_active`;
      params = [name, email, hashed, role, color || null, req.params.id];
    } else {
      sql    = `UPDATE users SET name=$1, email=$2, role=$3, color=$4, updated_at=NOW()
                WHERE id=$5 RETURNING id, name, email, role, color, is_active`;
      params = [name, email, role, color || null, req.params.id];
    }

    const result = await pool.query(sql, params);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Employé introuvable' });
    logger.info('Employee updated', { userId: req.user.id });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('Error while updating employee', { message: err.message, userId: req.user.id });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DELETE /employees/:id ────────────────────────────────────────────────────
// BUG CORRIGÉ : hard DELETE → soft delete (is_active=false)
// Un DELETE physique casserait l'historique des commandes liées à cet employé
const remove = async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1', [req.params.id]);
    logger.info('Employee deactivated', { targetId: req.params.id, by: req.user.id });
    res.json({ success: true, message: 'Employé désactivé' });
  } catch (err) {
    logger.error('Error while deactivating employee', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getAllRules, updateRules, validate, getAll, getOne, update, remove };

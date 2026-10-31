const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const pool   = require('../../config/database');
const logger = require('../../config/logger');
const { body, validationResult } = require('express-validator');

// ─── Middleware de vérification des erreurs de validation ─────────────────────
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ─── Règles de validation ─────────────────────────────────────────────────────
const registerRules = [
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
  body('role')
    .optional()
    .isIn(['admin', 'manager', 'cashier']).withMessage('Rôle invalide'),
];

const loginRules = [
  body('email')
    .trim()
    .isEmail().withMessage('Email invalide')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Mot de passe requis'),
];

// ─── POST /auth/register ──────────────────────────────────────────────────────
const register = async (req, res) => {
  try {
    const { name, email, password, role = 'cashier' } = req.body;

    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, created_at`,
      [name, email, hashed, role]
    );

    const token = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    });

    logger.info('Account created', { user: result.rows[0].name });
    res.status(201).json({ success: true, data: { user: result.rows[0], token } });
  } catch (err) {
    logger.error('Error while creating account', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /auth/login ─────────────────────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email]
    );

    if (!result.rows[0]) {
      return res.status(401).json({ success: false, message: 'Identifiants incorrects' });
    }

    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Identifiants incorrects' });
    }

    const { password: _, ...user } = result.rows[0];
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    });

    logger.info('Login successful', { userId: user.id });
    res.json({ success: true, data: { user, token } });
  } catch (err) {
    logger.error('Error while login', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
const me = async (req, res) => {
  res.json({ success: true, data: req.user });
};

module.exports = { registerRules, loginRules, validate, register, login, me };

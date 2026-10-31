const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const pool = require('../../config/database');

// ── Auth ──────────────────────────────────────────────────────────────────────
const auth = require('../controllers/authController');
router.post('/auth/register', auth.register);
router.post('/auth/login',    auth.login);
router.get ('/auth/me',       authenticate, auth.me);

// ── Products (= Prestations) ──────────────────────────────────────────────────
const products = require('../controllers/productController');
router.get   ('/products',            authenticate, products.getAll);
router.get   ('/products/barcode/:b', authenticate, products.getByBarcode);
router.get   ('/products/:id',        authenticate, products.getOne);
router.post  ('/products',            authenticate, authorize('admin','manager'), products.create);
router.put   ('/products/:id',        authenticate, authorize('admin','manager'), products.update);
router.delete('/products/:id',        authenticate, authorize('admin'), products.remove);

// ── Categories ────────────────────────────────────────────────────────────────
router.get('/categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories WHERE is_active = true ORDER BY name');
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});
router.post('/categories', authenticate, authorize('admin','manager'), async (req, res) => {
  try {
    const { name, color, icon } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name requis' });
    const result = await pool.query(
      'INSERT INTO categories (name, color, icon) VALUES ($1,$2,$3) RETURNING *',
      [name, color || '#f0c987', icon || '✦']
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});
router.put('/categories/:id', authenticate, authorize('admin','manager'), async (req, res) => {
  try {
    const { name, color, icon } = req.body;
    const result = await pool.query(
      'UPDATE categories SET name=$1, color=$2, icon=$3 WHERE id=$4 RETURNING *',
      [name, color, icon, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Catégorie introuvable' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Orders ────────────────────────────────────────────────────────────────────
const orders = require('../controllers/orderController');
router.get ('/orders',           authenticate, orders.getAll);
router.get ('/orders/:id',       authenticate, orders.getOne);
router.post('/orders',           authenticate, orders.create);
router.post('/orders/:id/refund',authenticate, authorize('admin','manager'), orders.refund);
router.delete('/orders/:id',       authenticate, orders.remove);

// ── Customers ─────────────────────────────────────────────────────────────────
const customers = require('../controllers/customerController');
router.get('/customers',     authenticate, customers.getAll);
router.get('/customers/:id', authenticate, customers.getOne);
router.post('/customers',    authenticate, customers.create);
router.put('/customers/:id', authenticate, customers.update);

// ── Users ─────────────────────────────────────────────────────────────────
const users = require('../controllers/userController');
router.get('/users',     authenticate, users.getAll);
router.get('/users/:id', authenticate, users.getOne);
router.post('/users',    authenticate, users.create);
router.put('/users/:id', authenticate, users.update);

// ── Employees ─────────────────────────────────────────────────────────────────
const employees = require('../controllers/employeeController');
router.get('/employees',     authenticate, employees.getAll);
router.get('/employees/:id', authenticate, employees.getOne);
// Création = register avec rôle (admin only)
router.post('/employees', authenticate, authorize('admin'), async (req, res) => {
  const bcrypt = require('bcryptjs');
  try {
    const { name, email, password = 'changeme123', role = 'cashier', color = '#f0c987' } = req.body;
    if (!name || !email) return res.status(400).json({ success: false, message: 'name et email requis' });
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length) return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
    const hashed = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, color) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, email, role, color, created_at`,
      [name, email, hashed, role, color]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});
router.put('/employees/:id', authenticate, authorize('admin'), employees.update);
router.delete('/employees/:id', authenticate, authorize('admin'), employees.remove);

// ── Expenses ──────────────────────────────────────────────────────────────────
const expenses = require('../controllers/expenseController');
router.get   ('/expenses',     authenticate, expenses.getAll);
router.post  ('/expenses',     authenticate, expenses.create);
router.put   ('/expenses/:id', authenticate, authorize('admin','manager'), expenses.update);
router.delete('/expenses/:id', authenticate, authorize('admin','manager'), expenses.remove);

// ── Reports ───────────────────────────────────────────────────────────────────
const reports = require('../controllers/reportController');
router.get('/reports/dashboard',    authenticate, reports.dashboard);
router.get('/reports/sales',        authenticate, authorize('admin','manager'), reports.sales);
router.get('/reports/products',     authenticate, authorize('admin','manager'), reports.products);
router.get('/reports/stock-alerts', authenticate, reports.stockAlerts);

// ── Upload ───────────────────────────────────────────────────────────────────
const upload = require("../controllers/uploadController");
router.post("/upload/receipt", authenticate, upload.uploadReceipt);

// ── Export ───────────────────────────────────────────────────────────────────
const exporter = require("../controllers/exportController");
router.get("/export/depenses", authenticate, authorize('admin','manager'), exporter.exportDepenses);

module.exports = router;

const pool   = require('../../config/database');
const logger = require('../../config/logger');
const { query, validationResult } = require('express-validator');

// ─── Middleware de vérification ───────────────────────────────────────────────
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ─── Règles de validation ─────────────────────────────────────────────────────
const salesRules = [
  query('from').optional().isISO8601().withMessage('Date "from" invalide (format YYYY-MM-DD)'),
  query('to').optional().isISO8601().withMessage('Date "to" invalide (format YYYY-MM-DD)'),
  query('group_by').optional().isIn(['day', 'month']).withMessage('group_by invalide (day ou month)'),
];

const productsRules = [
  query('from').optional().isISO8601().withMessage('Date "from" invalide'),
  query('to').optional().isISO8601().withMessage('Date "to" invalide'),
];

// ─── GET /reports/dashboard ───────────────────────────────────────────────────
const dashboard = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [sales, topProducts, paymentBreakdown, hourly] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) AS total_orders,
               COALESCE(SUM(total),0) AS revenue,
               COALESCE(AVG(total),0) AS avg_basket
        FROM orders WHERE DATE(order_date) = $1 AND status = 'completed'`, [today]),
      pool.query(`
        SELECT oi.product_name, SUM(oi.quantity) AS qty_sold, SUM(oi.subtotal) AS revenue
        FROM order_items oi JOIN orders o ON oi.order_id = o.id
        WHERE DATE(o.order_date) = $1 AND o.status = 'completed'
        GROUP BY oi.product_name ORDER BY qty_sold DESC LIMIT 5`, [today]),
      pool.query(`
        SELECT op.method, COUNT(*) AS count, SUM(op.amount) AS total
        FROM order_payments op JOIN orders o ON op.order_id = o.id
        WHERE DATE(o.order_date) = $1 AND o.status = 'completed' AND op.status = 'completed'
        GROUP BY op.method`, [today]),
      pool.query(`
        SELECT EXTRACT(HOUR FROM order_date) AS hour,
               COUNT(*) AS orders, SUM(total) AS revenue
        FROM orders WHERE DATE(order_date) = $1 AND status = 'completed'
        GROUP BY hour ORDER BY hour`, [today]),
    ]);

    res.json({
      success: true,
      data: {
        today:             sales.rows[0],
        top_products:      topProducts.rows,
        payment_breakdown: paymentBreakdown.rows,
        hourly_sales:      hourly.rows,
      },
    });
  } catch (err) {
    logger.error('Error while retrieving dashboard', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /reports/sales ───────────────────────────────────────────────────────
const sales = async (req, res) => {
  try {
    const { from, to, group_by = 'day' } = req.query;
    const params = [from || '2000-01-01', to || new Date().toISOString().split('T')[0]];
    const groupSQL = group_by === 'month'
      ? `DATE_TRUNC('month', order_date)`
      : `DATE(order_date)`;

    const [periods, byPayment, byEmployee] = await Promise.all([
      pool.query(`
        SELECT ${groupSQL} AS period,
               COUNT(*) AS total_orders,
               SUM(total) AS revenue,
               SUM(discount_amount) AS discounts,
               AVG(total) AS avg_basket
        FROM orders
        WHERE order_date >= $1 AND order_date <= $2::date + 1 AND status = 'completed'
        GROUP BY period ORDER BY period`, params),
      pool.query(`
        SELECT op.method, COUNT(*) AS count, SUM(op.amount) AS total
        FROM order_payments op
        JOIN orders o ON op.order_id = o.id
        WHERE o.order_date >= $1 AND o.order_date <= $2::date + 1
          AND o.status = 'completed' AND op.status = 'completed'
        GROUP BY op.method`, params),
      pool.query(`
        SELECT u.id, u.name, u.color,
               COUNT(o.id) AS total_orders, SUM(o.total) AS revenue
        FROM orders o
        JOIN users u ON o.cashier_id = u.id
        WHERE o.order_date >= $1 AND o.order_date <= $2::date + 1 AND o.status = 'completed'
        GROUP BY u.id, u.name, u.color ORDER BY revenue DESC`, params),
    ]);

    res.json({
      success: true,
      data: { periods: periods.rows, by_payment: byPayment.rows, by_employee: byEmployee.rows },
    });
  } catch (err) {
    logger.error('Error while retrieving sales report', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /reports/products ────────────────────────────────────────────────────
// BUG CORRIGÉ : "result" référencé dans le catch alors qu'il peut ne pas exister
const products = async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [from || '2000-01-01', to || new Date().toISOString().split('T')[0]];
    const result = await pool.query(`
      SELECT oi.product_id, oi.product_name,
             SUM(oi.quantity) AS qty_sold,
             SUM(oi.subtotal) AS revenue,
             COUNT(DISTINCT oi.order_id) AS order_count
      FROM order_items oi JOIN orders o ON oi.order_id = o.id
      WHERE o.order_date >= $1 AND o.order_date <= $2::date + 1 AND o.status = 'completed'
      GROUP BY oi.product_id, oi.product_name
      ORDER BY revenue DESC LIMIT 50`, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('Error while retrieving products report', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /reports/stock-alerts ────────────────────────────────────────────────
// BUG CORRIGÉ : "result" référencé dans le catch alors qu'il peut ne pas exister
const stockAlerts = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, stock, stock_alert, price FROM products
      WHERE stock <= stock_alert AND is_active = true ORDER BY stock ASC`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('Error while retrieving stock alerts', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { salesRules, productsRules, validate, dashboard, sales, products, stockAlerts };

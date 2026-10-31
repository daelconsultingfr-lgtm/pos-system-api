const pool   = require('../../config/database');
const logger = require('../../config/logger');
const { body, param, query, validationResult } = require('express-validator');

const PAYMENT_METHODS = ['cash', 'card', 'contactless', 'check', 'treatwell', 'planity', 'mixed'];
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
  query('from').optional().isISO8601().withMessage('Date "from" invalide'),
  query('to').optional().isISO8601().withMessage('Date "to" invalide'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page invalide').toInt(),
  query('limit').optional().isInt({ min: 1, max: MAX_LIMIT }).withMessage(`Limite invalide (max ${MAX_LIMIT})`).toInt(),
  query('cashier_id').optional().isInt({ min: 1 }).withMessage('cashier_id invalide'),
  query('customer_id').optional().isInt({ min: 1 }).withMessage('customer_id invalide'),
];

const createRules = [
  body('items')
    .isArray({ min: 1 }).withMessage('Au moins un article requis'),
  body('items.*.product_id')
    .isInt({ min: 1 }).withMessage('product_id invalide'),
  body('items.*.quantity')
    .isInt({ min: 1 }).withMessage('Quantité invalide (minimum 1)'),
  body('items.*.discount')
    .optional()
    .isFloat({ min: 0 }).withMessage('Remise article invalide'),
  body('payment_breakdown')
    .isArray({ min: 1 }).withMessage('Au moins un paiement requis'),
  body('payment_breakdown.*.method')
    .isIn(PAYMENT_METHODS).withMessage('Mode de paiement invalide'),
  body('payment_breakdown.*.amount')
    .isFloat({ min: 0.01 }).withMessage('Montant de paiement invalide'),
  body('discount_amount')
    .optional()
    .isFloat({ min: 0 }).withMessage('Remise invalide'),
  body('additionnal_fees')
    .optional()
    .isFloat().withMessage('Frais supplémentaires invalides'),
  body('order_date')
    .optional()
    .isISO8601().withMessage('Date invalide (format YYYY-MM-DD)'),
  body('customer_id')
    .optional({ checkFalsy: true })
    .isInt({ min: 1 }).withMessage('customer_id invalide'),
  body('employee_id')
    .optional({ checkFalsy: true })
    .isInt({ min: 1 }).withMessage('employee_id invalide'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Notes trop longues (max 500 caractères)'),
];

const updateRules = [
  param('id').isInt({ min: 1 }).withMessage('ID invalide'),
  body('order_date')
    .optional()
    .isISO8601().withMessage('Date invalide'),
  body('discount_amount')
    .optional()
    .isFloat({ min: 0 }).withMessage('Remise invalide'),
  body('customer_id')
    .optional({ checkFalsy: true })
    .isInt({ min: 1 }).withMessage('customer_id invalide'),
  body('employee_id')
    .optional({ checkFalsy: true })
    .isInt({ min: 1 }).withMessage('employee_id invalide'),
  body('payment_method')
    .optional()
    .isIn(PAYMENT_METHODS).withMessage('Mode de paiement invalide'),
  body('amount_paid')
    .optional()
    .isFloat({ min: 0 }).withMessage('Montant encaissé invalide'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Notes trop longues (max 500 caractères)'),
  body('items')
    .optional()
    .isArray().withMessage('items doit être un tableau'),
  body('items.*.product_id')
    .optional()
    .isInt({ min: 1 }).withMessage('product_id invalide'),
  body('items.*.quantity')
    .optional()
    .isInt({ min: 1 }).withMessage('Quantité invalide'),
  body('items.*.unit_price')
    .optional()
    .isFloat({ min: 0 }).withMessage('Prix unitaire invalide'),
];

// ─── GET /orders ──────────────────────────────────────────────────────────────
const getAll = async (req, res) => {
  try {
    const { status, from, to, cashier_id, customer_id, page = 1, limit = 20 } = req.query;
    const safeLimit = Math.min(parseInt(limit), MAX_LIMIT);
    const params = [];
    const where  = [];

    if (status)      { params.push(status);      where.push(`o.status = $${params.length}`); }
    if (from)        { params.push(from);         where.push(`DATE(o.order_date) >= $${params.length}`); }
    if (to)          { params.push(to);           where.push(`DATE(o.order_date) <= $${params.length}`); }
    if (cashier_id)  { params.push(cashier_id);   where.push(`o.cashier_id = $${params.length}`); }
    if (customer_id) { params.push(customer_id);  where.push(`o.customer_id = $${params.length}`); }

    const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM orders o ${whereSQL}`, params);
    const offset = (page - 1) * safeLimit;
    params.push(safeLimit, offset);

    const result = await pool.query(
      `SELECT o.*, u.name AS employee_name, c.name AS customer_name
       FROM orders o
       LEFT JOIN users u ON o.cashier_id = u.id
       LEFT JOIN customers c ON o.customer_id = c.id
       ${whereSQL}
       ORDER BY o.order_date DESC, o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    logger.info('Orders found', { ordersFound: parseInt(countResult.rows[0].count) });
    res.json({
      success: true,
      data: result.rows,
      pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: safeLimit },
    });
  } catch (err) {
    logger.error('Error while retrieving orders', { message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /orders/:id ──────────────────────────────────────────────────────────
const getOne = async (req, res) => {
  try {
    const order = await pool.query(
      `SELECT o.*, u.name AS cashier_name, c.name AS customer_name, c.email AS customer_email
       FROM orders o
       LEFT JOIN users u ON o.cashier_id = u.id
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!order.rows[0]) return res.status(404).json({ success: false, message: 'Commande introuvable' });

    const items    = await pool.query('SELECT * FROM order_items    WHERE order_id = $1 ORDER BY id', [req.params.id]);
    const payments = await pool.query('SELECT * FROM order_payments WHERE order_id = $1', [req.params.id]);

    logger.info('Order found', { orderId: req.params.id });
    res.json({ success: true, data: { ...order.rows[0], items: items.rows, payments: payments.rows } });
  } catch (err) {
    logger.error('Error while retrieving order', { message: err.message, orderId: req.params.id });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /orders ─────────────────────────────────────────────────────────────
// BUG CORRIGÉ : order_date sans fallback → null envoyé à la BDD
const create = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      customer_id, employee_id,
      order_date,
      items,
      discount_amount  = 0,
      additionnal_fees = 0,
      notes,
      payment_breakdown = [],
    } = req.body;

    // ── Calcul des totaux ──
    let subtotal = 0;
    const enrichedItems = [];
    for (const item of items) {
      const pRes = await client.query(
        'SELECT * FROM products WHERE id = $1 AND is_active = true', [item.product_id]
      );
      if (!pRes.rows[0]) throw new Error(`Produit ${item.product_id} introuvable`);
      const p = pRes.rows[0];
      const lineSubtotal = p.price * item.quantity - (item.discount || 0);
      subtotal += lineSubtotal;
      enrichedItems.push({ ...item, _product: p, _subtotal: lineSubtotal });
    }

    const total          = Math.max(0, subtotal - parseFloat(discount_amount) + parseFloat(additionnal_fees));
    const methods        = payment_breakdown.map(p => p.method);
    const payment_method = methods.length === 1 ? methods[0] : 'mixed';
    const amount_paid    = payment_breakdown.reduce((s, p) => s + parseFloat(p.amount), 0);
    const cashPaid       = payment_breakdown.filter(p => p.method === 'cash').reduce((s, p) => s + parseFloat(p.amount), 0);
    const nonCashPaid    = payment_breakdown.filter(p => p.method !== 'cash').reduce((s, p) => s + parseFloat(p.amount), 0);
    const change_due     = cashPaid > 0 ? Math.max(0, cashPaid + nonCashPaid - total) : 0;

    const seqRes = await client.query("SELECT nextval('order_number_seq') AS num");
    const order_number = `CMD-${String(seqRes.rows[0].num).padStart(6, '0')}`;

    const orderRes = await client.query(
      `INSERT INTO orders
         (order_number, customer_id, cashier_id, order_date, status,
          subtotal, tax_amount, discount_amount, additionnal_fees, total,
          payment_method, amount_paid, change_due, notes)
       VALUES ($1,$2,$3,$4,'completed',$5,0,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        order_number,
        customer_id  || null,
        employee_id  || null,
        order_date   || new Date().toISOString().split('T')[0],  // ← fallback ajouté
        subtotal,
        parseFloat(discount_amount),
        parseFloat(additionnal_fees),
        total,
        payment_method,
        amount_paid,
        change_due,
        notes || null,
      ]
    );
    const order = orderRes.rows[0];

    for (const item of enrichedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, tax_rate, discount, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [order.id, item.product_id, item._product.name, item.quantity,
         item._product.price, item._product.tax_rate || 0, item.discount || 0, item._subtotal]
      );
    }

    for (const pb of payment_breakdown) {
      const change_given = pb.method === 'cash' ? change_due : 0;
      await client.query(
        `INSERT INTO order_payments (order_id, method, amount, change_given, reference, status)
         VALUES ($1,$2,$3,$4,$5,'completed')`,
        [order.id, pb.method, parseFloat(pb.amount), change_given, pb.reference || null]
      );
    }

    if (customer_id) {
      await client.query(
        'UPDATE customers SET total_spent = total_spent + $1, loyalty_points = loyalty_points + $2 WHERE id = $3',
        [total, Math.floor(total / 10), customer_id]
      );
    }

    await client.query('COMMIT');

    const finalOrder    = await pool.query(
      `SELECT o.*, u.name AS cashier_name, c.name AS customer_name
       FROM orders o
       LEFT JOIN users u ON o.cashier_id = u.id
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id = $1`, [order.id]
    );
    const finalItems    = await pool.query('SELECT * FROM order_items    WHERE order_id = $1', [order.id]);
    const finalPayments = await pool.query('SELECT * FROM order_payments WHERE order_id = $1', [order.id]);

    logger.info('Order created', { orderId: order.id });
    res.status(201).json({
      success: true,
      data: { ...finalOrder.rows[0], items: finalItems.rows, payments: finalPayments.rows },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error while creating order', { message: err.message });
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ─── POST /orders/:id/refund ──────────────────────────────────────────────────
const refund = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await client.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!order.rows[0])                      throw new Error('Commande introuvable');
    if (order.rows[0].status === 'refunded') throw new Error('Commande déjà remboursée');

    const items = await client.query('SELECT * FROM order_items WHERE order_id = $1', [req.params.id]);
    for (const item of items.rows) {
      if (item.product_id) {
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
      }
    }

    await client.query(`UPDATE orders SET status = 'refunded', updated_at = NOW() WHERE id = $1`, [req.params.id]);
    await client.query(
      `INSERT INTO order_payments (order_id, method, amount, status) VALUES ($1,$2,$3,'refunded')`,
      [req.params.id, order.rows[0].payment_method, -order.rows[0].total]
    );

    if (order.rows[0].customer_id) {
      await client.query(
        'UPDATE customers SET total_spent = total_spent - $1 WHERE id = $2',
        [order.rows[0].total, order.rows[0].customer_id]
      );
    }

    await client.query('COMMIT');
    logger.info('Order refunded', { orderId: req.params.id });
    res.json({ success: true, message: 'Remboursement effectué' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error while refunding order', { message: err.message });
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ─── DELETE /orders/:id ───────────────────────────────────────────────────────
const remove = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT id FROM orders WHERE id=$1', [id]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Commande introuvable' });
    }

    await client.query('DELETE FROM order_payments WHERE order_id=$1', [id]);
    await client.query('DELETE FROM order_items    WHERE order_id=$1', [id]);
    await client.query('DELETE FROM orders         WHERE id=$1',       [id]);

    await client.query('COMMIT');
    logger.info('Order deleted', { orderId: id, by: req.user.id });
    res.json({ success: true, message: 'Commande supprimée' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error while deleting order', { message: err.message, orderId: id });
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

module.exports = { getAllRules, createRules, updateRules, validate, getAll, getOne, create, refund, remove };

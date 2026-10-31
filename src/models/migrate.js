const pool = require('../../config/database');

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Table utilisateurs (caissiers, managers)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin', 'manager', 'cashier')),
        color VARCHAR(7) DEFAULT '#f0c987',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Table clients
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE,
        phone VARCHAR(20),
        address TEXT,
        loyalty_points INTEGER DEFAULT 0,
        total_spent DECIMAL(12,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Table catégories de produits
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        color VARCHAR(7) DEFAULT '#3B82F6',
        icon VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Table produits
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        duration VARCHAR(50),
        barcode VARCHAR(100) UNIQUE,
        price DECIMAL(10,2) NOT NULL,
        tax_rate DECIMAL(5,2) DEFAULT 20.00,
        stock INTEGER DEFAULT 0,
        stock_alert INTEGER DEFAULT 5,
        image_url TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Table commandes / tickets de caisse
    // - payment_method : résumé calculé ('cash'|'card'|'mixed'|...) — déduit des lignes payments
    // - amount_paid    : somme de tous les payments (colonne dénormalisée pour accès rapide)
    // - change_due     : monnaie rendue (espèces reçues - total, si espèces > total)
    // - additionnal_fees : frais ou déductions post-sous-total (valeur signée : + supplément, - déduction)
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number     VARCHAR(20)   UNIQUE NOT NULL,
        customer_id      UUID          REFERENCES customers(id) ON DELETE SET NULL,
        cashier_id       UUID          REFERENCES users(id) ON DELETE SET NULL,
        order_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
        status           VARCHAR(20)   NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'completed', 'cancelled', 'refunded')),

        -- Montants
        subtotal         DECIMAL(12,2) NOT NULL DEFAULT 0,
        tax_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
        discount_amount  DECIMAL(12,2)          DEFAULT 0,
        additionnal_fees DECIMAL(12,2)          DEFAULT 0, -- signé : + supplément / - déduction
        total            DECIMAL(12,2) NOT NULL DEFAULT 0,

        -- Synthèse paiement (calculée à partir de order_payments)
        payment_method   VARCHAR(20)   CHECK (payment_method IN ('cash', 'card', 'contactless', 'check', 'treatwell', 'planity', 'mixed')),
        amount_paid      DECIMAL(12,2)          DEFAULT 0, -- somme des lignes order_payments
        change_due       DECIMAL(12,2)          DEFAULT 0, -- rendu monnaie espèces

        notes            TEXT,
        created_at       TIMESTAMP     NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP     NOT NULL DEFAULT NOW()
      );
    `);

    // Table lignes de commande
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id     UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id   UUID          REFERENCES products(id) ON DELETE SET NULL,
        product_name VARCHAR(200)  NOT NULL,
        quantity     INTEGER       NOT NULL DEFAULT 1 CHECK (quantity > 0),
        unit_price   DECIMAL(10,2) NOT NULL,
        tax_rate     DECIMAL(5,2)           DEFAULT 0.00,
        discount     DECIMAL(10,2)          DEFAULT 0,
        subtotal     DECIMAL(12,2) NOT NULL,
        created_at   TIMESTAMP     NOT NULL DEFAULT NOW()
      );
    `);

    // Table des lignes de paiement — 1 ligne par mode de paiement utilisé
    // Remplace l'ancienne colonne payment_method unique sur orders.
    // Exemples :
    // --   CB 40 € + Espèces 20 €  → 2 lignes, orders.payment_method = 'mixed'
    // --   CB 60 €                 → 1 ligne,  orders.payment_method = 'card'
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_payments (
        id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id     UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        method       VARCHAR(20)   NOT NULL
                       CHECK (method IN ('cash', 'card', 'contactless', 'check', 'treatwell', 'planity')),
        amount       DECIMAL(12,2) NOT NULL CHECK (amount > 0),
        -- Monnaie rendue uniquement pertinente pour la ligne espèces
        change_given DECIMAL(12,2)          DEFAULT 0,
        -- Référence externe optionnelle (n° TPE, id transaction Treatwell…)
        reference    VARCHAR(100),
        status       VARCHAR(20)   NOT NULL DEFAULT 'completed'
                       CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
        processed_at TIMESTAMP     NOT NULL DEFAULT NOW()
      );
    `);

    // Table dépenses
    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        label       VARCHAR(200)  NOT NULL,
        amount      DECIMAL(12,2) NOT NULL CHECK (amount > 0),
        category    VARCHAR(100),
        date        DATE          NOT NULL DEFAULT CURRENT_DATE,
        notes       TEXT,
        receipt_url TEXT,
        created_by  UUID          REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMP     NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP     NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);`);

    // Séquence pour numéros de commande
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1000;
    `);

    // Index pour performances
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_created_at    ON orders(created_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_status        ON orders(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_customer      ON orders(customer_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_barcode     ON products(barcode);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_order_items_order    ON order_items(order_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_order_payments_order ON order_payments(order_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_order_payments_method ON order_payments(method);`);

    await client.query('COMMIT');
    console.log('✅ Migration réussie - toutes les tables créées');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur migration:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

migrate();

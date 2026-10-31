# 🛒 Caisse API — Node.js + Express + PostgreSQL

API REST d'encaissement compatible iPhone & iPad.

---

## 🚀 Installation

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer l'environnement
cp .env.example .env
# Éditer .env avec vos paramètres PostgreSQL

# 3. Créer la base de données PostgreSQL
createdb caisse_db

# 4. Lancer les migrations (crée toutes les tables)
npm run migrate

# 5. Démarrer le serveur
npm run dev        # développement (nodemon)
npm start          # production
```

---

## 🔐 Authentification

Toutes les routes (sauf login/register) nécessitent un token JWT :

```
Authorization: Bearer <token>
```

### Rôles
| Rôle | Accès |
|------|-------|
| `cashier` | Ventes, produits, clients |
| `manager` | + Créer/modifier produits, remboursements, rapports |
| `admin` | Accès total |

---

## 📡 Endpoints

### Auth
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/v1/auth/register` | Créer un compte |
| POST | `/api/v1/auth/login` | Se connecter |
| GET | `/api/v1/auth/me` | Profil courant |

**Login :**
```json
POST /api/v1/auth/login
{ "email": "caissier@shop.com", "password": "motdepasse" }

Réponse:
{ "success": true, "data": { "user": {...}, "token": "eyJ..." } }
```

---

### Produits
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/v1/products` | Liste (filtres: search, category_id, page) |
| GET | `/api/v1/products/barcode/:code` | Recherche par code-barres |
| GET | `/api/v1/products/:id` | Détail produit |
| POST | `/api/v1/products` | Créer (manager/admin) |
| PUT | `/api/v1/products/:id` | Modifier (manager/admin) |
| DELETE | `/api/v1/products/:id` | Désactiver (admin) |

**Créer un produit :**
```json
POST /api/v1/products
{
  "name": "Café expresso",
  "price": 2.50,
  "tax_rate": 10,
  "stock": 100,
  "stock_alert": 10,
  "category_id": "uuid-catégorie",
  "barcode": "3760123456789"
}
```

---

### Catégories
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/v1/categories` | Liste des catégories |
| POST | `/api/v1/categories` | Créer une catégorie |

---

### 💰 Commandes / Encaissement
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/v1/orders` | Historique (filtres: status, from, to) |
| GET | `/api/v1/orders/:id` | Ticket complet avec articles |
| POST | `/api/v1/orders` | **Créer une vente** |
| POST | `/api/v1/orders/:id/refund` | Rembourser (manager/admin) |

**Créer une vente (encaissement) :**
```json
POST /api/v1/orders
{
  "customer_id": "uuid-client",          // optionnel
  "payment_method": "card",              // cash | card | contactless | check | mixed
  "amount_paid": 20.00,
  "discount_amount": 0,
  "notes": "Table 5",
  "items": [
    {
      "product_id": "uuid-produit",
      "quantity": 2,
      "discount": 0
    },
    {
      "product_id": "uuid-produit-2",
      "quantity": 1,
      "discount": 0.50
    }
  ]
}

Réponse:
{
  "success": true,
  "data": {
    "id": "uuid",
    "order_number": "CMD-001042",
    "total": 17.50,
    "change_due": 2.50,
    "items": [...],
    ...
  }
}
```

---

### Clients
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/v1/customers` | Liste (filtre: search) |
| GET | `/api/v1/customers/:id` | Fiche client + historique |
| POST | `/api/v1/customers` | Créer un client |
| PUT | `/api/v1/customers/:id` | Modifier |

---

### 📊 Rapports
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/v1/reports/dashboard` | CA du jour, top produits, paiements |
| GET | `/api/v1/reports/sales?from=&to=&group_by=day` | Ventes par période |
| GET | `/api/v1/reports/products?from=&to=` | Classement produits |
| GET | `/api/v1/reports/stock-alerts` | Produits en rupture |

---

## 📱 Intégration iOS (Swift)

```swift
// Exemple d'appel depuis Swift
let url = URL(string: "https://votre-api.com/api/v1/auth/login")!
var request = URLRequest(url: url)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")

let body = ["email": "user@shop.com", "password": "monmotdepasse"]
request.httpBody = try? JSONEncoder().encode(body)

URLSession.shared.dataTask(with: request) { data, response, error in
    if let data = data {
        let result = try? JSONDecoder().decode(LoginResponse.self, from: data)
        // Stocker result.data.token dans Keychain
    }
}.resume()
```

---

## 🗄️ Structure du projet

```
caisse-api/
├── src/
│   ├── server.js              # Point d'entrée
│   ├── routes/
│   │   └── index.js           # Toutes les routes
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── productController.js
│   │   ├── orderController.js
│   │   ├── customerController.js
│   │   └── reportController.js
│   ├── middleware/
│   │   └── auth.js            # JWT + autorisation
│   └── models/
│       └── migrate.js         # Création des tables
├── config/
│   └── database.js            # Pool PostgreSQL
├── .env.example
└── package.json
```

---

## 🔒 Sécurité en production

- Configurer CORS avec les domaines spécifiques de votre app
- Utiliser HTTPS (SSL/TLS)
- Stocker les secrets dans des variables d'environnement sécurisées
- Activer rate limiting (`express-rate-limit`)
- Ajouter helmet.js pour les headers HTTP sécurisés

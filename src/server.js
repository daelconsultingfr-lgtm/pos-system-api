require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const routes = require('./routes');
const path = require("path");
const handleUploadError  = require("./controllers/uploadController");
const logger = require("../config/logger");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");


const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5175',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Routes
app.use('/api/v1', routes);
app.use("/invoices", express.static(path.join(__dirname, "..", "src", "invoices")));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} introuvable` });
});

// Error handler
app.use((err, req, res, next,handleUploadError) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Erreur serveur interne' });
});

//Logger
app.use((req, res, next) => {
  res.on("finish", () => {
    const level = res.statusCode >= 400 ? "warn" : "info";
    logger[level](`${req.method} ${req.originalUrl}`, {
      status: res.statusCode,
      ip:     req.ip,
      user:   req.user?.id,
    });
  });
  next();
});


app.listen(PORT, () => {
  console.log(`\n🚀 Caisse API démarrée sur http://localhost:${PORT}`);
  console.log(`📋 Health: http://localhost:${PORT}/health`);
  console.log(`📡 API: http://localhost:${PORT}/api/v1\n`);
});

// Sur toutes les routes
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// Plus strict sur le login
app.use("/api/v1/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));

app.use(helmet());

module.exports = app;

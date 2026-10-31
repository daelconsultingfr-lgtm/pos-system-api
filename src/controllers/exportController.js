const path     = require('path');
const fs       = require('fs');
const ExcelJS  = require('exceljs');
const archiver = require('archiver');
const pool     = require('../../config/database');
const logger   = require('../../config/logger');
const { query, validationResult } = require('express-validator');

const INVOICES_ROOT = path.join(__dirname, '..', '..', 'src', 'invoices');

// ─── Middleware de vérification ───────────────────────────────────────────────
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ─── Règles de validation ─────────────────────────────────────────────────────
const exportRules = [
  query('year')
    .optional()
    .isInt({ min: 2000, max: 2100 }).withMessage('Année invalide (ex: 2026)')
    .toInt(),
  query('month')
    .optional()
    .isInt({ min: 1, max: 12 }).withMessage('Mois invalide (1 à 12)')
    .toInt(),
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sanitize(str) {
  return (str || '').replace(/[^a-zA-Z0-9_\-éèàùâêîôûçÉÈÀÂÊÎÔÛÇ ]/g, '_').slice(0, 50);
}

async function buildExpensesWorkbook(expenses, year, month) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Caisse Institut de Beauté';
  wb.created  = new Date();

  const ws = wb.addWorksheet('Dépenses');

  // ── Titre ──
  ws.mergeCells('A1:H1');
  const titleCell = ws.getCell('A1');
  const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin',
                     'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  titleCell.value = `Dépenses — ${MONTHS_FR[parseInt(month) - 1]} ${year}`;
  titleCell.font  = { name: 'Arial', bold: true, size: 14, color: { argb: 'FFf0c987' } };
  titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0d1117' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;
  ws.addRow([]);

  // ── En-têtes ──
  const headerRow = ws.addRow(['#', 'Date', 'Description', 'Catégorie', 'Notes', 'Justificatif', 'Montant (€)']);
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e293b' } };
  headerRow.eachCell(cell => {
    cell.font      = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFe2e8f0' } };
    cell.fill      = headerFill;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border    = { bottom: { style: 'thin', color: { argb: 'FF334155' } } };
  });
  ws.getRow(3).height = 22;

  // ── Données ──
  const CAT_COLORS = {
    'Matériel': 'FF818cf8', 'Loyer': 'FFf87171', 'Stock': 'FF34d399',
    'Salaires': 'FFf59e0b', 'Services': 'FF60a5fa', 'Autre': 'FF94a3b8',
  };

  let rowIdx = 4;
  expenses.forEach((e, i) => {
    const hasReceipt = !!e.receipt_url;
    const filename   = hasReceipt ? path.basename(e.receipt_url) : '';
    const row = ws.addRow([
      i + 1,
      e.date || '',
      e.label || '',
      e.category || 'Autre',
      e.notes || '',
      hasReceipt ? `factures/${sanitize(e.label)}_${e.date}_${filename}` : '',
      parseFloat(e.amount || 0),
    ]);

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font  = { name: 'Arial', size: 10, color: { argb: 'FFe2e8f0' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FF0f172a' : 'FF0d1117' } };
      cell.alignment = { vertical: 'middle' };
    });

    const argb = CAT_COLORS[e.category] || 'FF94a3b8';
    row.getCell(4).font = { name: 'Arial', size: 10, bold: true, color: { argb } };

    const amtCell = row.getCell(7);
    amtCell.numFmt    = '#,##0.00 "€"';
    amtCell.alignment = { horizontal: 'right', vertical: 'middle' };
    amtCell.font      = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFf87171' } };

    row.height = 20;
    rowIdx++;
  });

  // ── Ligne total ──
  ws.addRow([]);
  const totalRow = ws.addRow(['', '', '', '', '', 'TOTAL', { formula: `=SUM(G4:G${rowIdx - 1})` }]);
  totalRow.getCell(6).font      = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFf0c987' } };
  totalRow.getCell(6).alignment = { horizontal: 'right' };
  totalRow.getCell(7).font      = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFf0c987' } };
  totalRow.getCell(7).numFmt    = '#,##0.00 "€"';
  totalRow.getCell(7).alignment = { horizontal: 'right' };
  totalRow.getCell(7).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e293b' } };
  totalRow.height = 24;

  ws.columns = [
    { key: 'num',     width: 5  }, { key: 'date',    width: 14 },
    { key: 'label',   width: 38 }, { key: 'cat',     width: 14 },
    { key: 'notes',   width: 28 }, { key: 'receipt', width: 52 },
    { key: 'amount',  width: 16 },
  ];
  ws.views = [{ state: 'frozen', ySplit: 3 }];

  return wb;
}

// ─── GET /export/depenses ─────────────────────────────────────────────────────
const exportDepenses = async (req, res) => {
  const year  = String(req.query.year  || new Date().getFullYear());
  const month = String(req.query.month || new Date().getMonth() + 1).padStart(2, '0');
  const from  = `${year}-${month}-01`;
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  const to    = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

  try {
    const { rows: expenses } = await pool.query(
      `SELECT id, label, amount, category, date, notes, receipt_url
       FROM expenses WHERE date BETWEEN $1 AND $2 ORDER BY date ASC, id ASC`,
      [from, to]
    );

    const wb         = await buildExpensesWorkbook(expenses, year, month);
    const xlsxBuffer = await wb.xlsx.writeBuffer();

    const zipName = `export_comptable_depenses_${year}_${month}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);
    archive.append(Buffer.from(xlsxBuffer), { name: `depenses_${year}_${month}.xlsx` });

    let invoiceCount = 0;
    for (const e of expenses) {
      if (!e.receipt_url) continue;
      const relative = e.receipt_url.replace(/^\/invoices\//, '');
      const fullPath  = path.join(INVOICES_ROOT, relative);
      if (!fs.existsSync(fullPath)) continue;
      const ext      = path.extname(e.receipt_url);
      const baseName = `${String(invoiceCount + 1).padStart(3, '0')}_${sanitize(e.label)}_${e.date}${ext}`;
      archive.file(fullPath, { name: `factures/${baseName}` });
      invoiceCount++;
    }

    await archive.finalize();
    logger.info('Export dépenses ZIP', { year, month, count: expenses.length, invoiceCount, userId: req.user?.id });
  } catch (err) {
    logger.error('Error while exporting expenses', { message: err.message });
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { exportRules, validate, exportDepenses };

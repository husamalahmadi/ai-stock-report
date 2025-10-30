import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, 'data');
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

function normalizeHeader(h) {
  return String(h).trim().toLowerCase();
}

function loadExcelToJson(filePath) {
  const wb = xlsx.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
  const out = [];
  for (const r of rows) {
    // Flexible header names
    const m = new Map(Object.entries(r).map(([k, v]) => [normalizeHeader(k), v]));
    const year = Number(m.get('year'));
    const revenue = Number(m.get('revenue') ?? m.get('sales'));
    const op = Number(m.get('operatingincome') ?? m.get('operating_income'));
    const net = Number(m.get('netincome') ?? m.get('net_income'));
    const shares = m.has('sharesoutstanding') ? Number(m.get('sharesoutstanding')) : null;
    if (!Number.isFinite(year)) continue;
    out.push({ year, revenue, operatingIncome: op, netIncome: net, sharesOutstanding: shares });
  }
  // sort by year
  out.sort((a,b)=>a.year-b.year);
  return out;
}

function saveJsonForTicker({ ticker, exchange, rows }) {
  const slug = `${exchange.toUpperCase()}_${ticker.toUpperCase()}`;
  const fp = path.join(outDir, slug + '.json');
  fs.writeFileSync(fp, JSON.stringify({ ticker, exchange, rows }, null, 2));
  console.log('Saved:', fp);
}

// Simple CLI: node ingest.js data/tesla.xlsx TSLA NASDAQ
const [,, excelPath, ticker, exchange] = process.argv;
if (!excelPath || !ticker || !exchange) {
  console.error('Usage: node ingest.js <excelPath> <ticker> <exchange>');
  process.exit(1);
}
const full = path.isAbsolute(excelPath) ? excelPath : path.join(__dirname, excelPath);
const rows = loadExcelToJson(full);
saveJsonForTicker({ ticker, exchange, rows });

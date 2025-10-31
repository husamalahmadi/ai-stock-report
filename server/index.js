import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

// ----------------- Paths & env -----------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 5050);
const TARGET_PE = Number(process.env.TARGET_PE || 25);
const DATA_DIR = path.join(__dirname, 'out');

// ----------------- App -----------------
const app = express();

// 1) Manual CORS guard (handles all routes & preflight)
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin'); // so caches vary per origin
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // If your frontend ever sends credentials, also add:
  // res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204); // preflight OK, no body
  }
  next();
});

// 2) Also keep cors() for good measure (won't hurt)
app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);

app.use(express.json());

// ----------------- OpenAI (optional) -----------------
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ----------------- Schemas -----------------
const querySchema = z.object({
  ticker: z.string().min(1),
  exchange: z.string().min(1),
});

// ----------------- Helpers -----------------
function loadDataset(exchange, ticker) {
  const fp = path.join(DATA_DIR, `${exchange.toUpperCase()}_${ticker.toUpperCase()}.json`);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function calcGrowth(series) {
  const out = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const curr = series[i];
    if (Number.isFinite(prev.revenue) && Number.isFinite(curr.revenue)) {
      const g = (curr.revenue - prev.revenue) / prev.revenue;
      out.push({ year: curr.year, growth: g });
    } else {
      out.push({ year: curr.year, growth: null });
    }
  }
  return out;
}

function computeFairValuePerYear(rows, targetPE = TARGET_PE) {
  return rows.map((r) => {
    const equityValue = Number.isFinite(r.netIncome) ? r.netIncome * targetPE : null;
    const perShare =
      r.sharesOutstanding && equityValue != null ? equityValue / r.sharesOutstanding : null;
    return { year: r.year, equityValue, fairValuePerShare: perShare };
  });
}

// ----------------- Routes -----------------
app.get('/', (_req, res) => {
  res.status(200).send('AI Stock Report API is running. Try GET /health or POST /report.');
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/report', async (req, res) => {
  try {
    const parsed = querySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }

    const { ticker, exchange } = parsed.data;
    const data = loadDataset(exchange, ticker);
    if (!data) {
      return res.status(404).json({ error: 'Data not found. Ingest Excel first.' });
    }

    const rows = data.rows.filter((r) => Number.isFinite(r.year));
    const salesGrowth = calcGrowth(rows);
    const fairValues = computeFairValuePerYear(rows);

    const response = {
      meta: { ticker, exchange, targetPE: TARGET_PE },
      rows,
      charts: {
        revenue: rows.map((r) => ({ year: r.year, value: r.revenue })),
        operatingIncome: rows.map((r) => ({ year: r.year, value: r.operatingIncome })),
        netIncome: rows.map((r) => ({ year: r.year, value: r.netIncome })),
      },
      growth: salesGrowth,
      fairValues,
    };

    // Optional AI narrative
    let ai = null;
    if (openai) {
      const sys = 'You are a financial analyst. Be concise and numeric-first.';
      const years = rows.map((r) => r.year).join(', ');
      const prompt =
        `Ticker ${ticker} on ${exchange}. Years: ${years}.\n` +
        `Revenue: ${rows.map((r) => r.revenue).join(', ')}.\n` +
        `Operating Income: ${rows.map((r) => r.operatingIncome).join(', ')}.\n` +
        `Net Income: ${rows.map((r) => r.netIncome).join(', ')}.\n` +
        `Revenue growth by year (yoy from 2nd year): ${salesGrowth
          .map((g) => `${g.year}:${(g.growth ?? 0).toFixed(3)}`)
          .join(', ')}.\n` +
        `Fair Value (equity) per year = NetIncome * PE(${TARGET_PE}).` +
        `Provide a short bullet report with insights, risks, and whether valuation trends are improving.`;

      try {
        const chat = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
        });
        ai = chat.choices?.[0]?.message?.content ?? null;
      } catch {
        ai = null;
      }
    }

    return res.json({ ...response, aiNarrative: ai });
  } catch (err) {
    console.error('Error in /report:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------- Start -----------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

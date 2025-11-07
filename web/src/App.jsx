// path: web/src/App.jsx
// Merged: Static JSON charts + per-year FV (PE) + Live EV/PE/PS + Ask AI (WebLLM/OpenAI/local)
// No server required for charts; TwelveData key is hardcoded for live metrics.

import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';

/* ================================== Config ================================== */
const DATA_URL = '/data/companies.json';       // { companies: [{ticker, exchange, rows:[...]}, ...] }
const TARGET_PE_DEFAULT = 25;

// --- TwelveData (HARDCODED KEY as requested) ---
const TWELVE_API_KEY = '5da413057f75498490b0303582e0d0de';

// --- Optional OpenAI (leave empty to skip cloud path) ---
const OPENAI_KEY   = import.meta.env.VITE_OPENAI_API_KEY || '';
const OPENAI_BASE  = import.meta.env.VITE_OPENAI_API_BASE || 'https://api.openai.com/v1';
const OPENAI_MODEL = import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o-mini';

// US market settings (for AAPL/MSFT)
const MARKET_SUFFIX_US = '';
const MARKET_CCY_US = 'USD';

/* ======================= Ask-AI plumbing & helpers ======================= */
// localStorage helpers
const cacheRead  = (k, f = null) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : f; } catch { return f; } };
const cacheWrite = (k, v)       => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// cache key for AI FV (depends on key inputs)
const AI_TTL_MS = 24 * 60 * 60 * 1000;
const round2 = (n) => (Number.isFinite(n) ? Number(n.toFixed(2)) : 0);
const aiInputsSig = (m) =>
  `${round2(m.fairEV)}|${round2(m.fairPE)}|${round2(m.fairPS)}|${round2(m.bookValue)}|${round2(m.price)}`;
const AI_CACHE_KEY = (symbolWithSuffix, sig) => `ai_fv_cache_v1_${symbolWithSuffix}_${sig}`;

// Optional WebLLM (dynamic import so app runs even if package not installed)
let _CreateMLCEngine = null;
let __engine = null;

async function loadCreateMLCEngine() {
  if (_CreateMLCEngine) return _CreateMLCEngine;
  const mod = await import(/* @vite-ignore */ '@mlc-ai/web-llm')
    .catch(() => { throw new Error('webllm_not_installed'); });
  _CreateMLCEngine = mod.CreateMLCEngine;
  return _CreateMLCEngine;
}
const MODEL_CANDIDATES = [
  'Phi-3-mini-4k-instruct-q4f16_1-MLC',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
];
async function getEngine() {
  if (__engine) return __engine;
  const CreateMLCEngine = await loadCreateMLCEngine(); // may throw webllm_not_installed
  let lastErr;
  for (const mid of MODEL_CANDIDATES) {
    try { __engine = await CreateMLCEngine(mid); return __engine; }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No WebLLM model could be initialized.');
}

// Extract {"fv":123.45} from LLM text (fenced or raw)
function extractJSON(text) {
  if (!text) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fence ? fence[1] : text;
  try { return JSON.parse(raw); } catch {}
  const i = raw.lastIndexOf('{'); const j = raw.lastIndexOf('}');
  if (i >= 0 && j > i) { try { return JSON.parse(raw.slice(i, j + 1)); } catch {} }
  return null;
}

/* ============================ Data helpers ============================ */
function normalizeFinancialRows(arr) {
  const out = [];
  for (const r of arr) {
    const year = num(r.year);
    const revenue = num(r.revenue);
    const op = num(r.operatingIncome);
    const net = num(r.netIncome);
    const shares = numOrNull(r.sharesOutstanding);
    if (!Number.isFinite(year)) continue;
    out.push({ year, revenue, operatingIncome: op, netIncome: net, sharesOutstanding: shares });
  }
  out.sort((a, b) => a.year - b.year);
  return out;
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function calcGrowth(series) {
  const out = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1], curr = series[i];
    if (Number.isFinite(prev?.revenue) && Number.isFinite(curr?.revenue)) {
      out.push({ year: curr.year, growth: (curr.revenue - prev.revenue) / prev.revenue });
    } else out.push({ year: curr.year, growth: null });
  }
  return out;
}
function computeFairValuePerYear(rows, targetPE) {
  return rows.map((r) => {
    const equityValue = Number.isFinite(r.netIncome) ? r.netIncome * targetPE : null;
    const perShare = r.sharesOutstanding && equityValue != null ? equityValue / r.sharesOutstanding : null;
    return { year: r.year, equityValue, fairValuePerShare: perShare };
  });
}
function mergeSeries(series) {
  const years = Array.from(new Set(series.flatMap((s) => s.data.map((d) => d.year)))).sort();
  return years.map((y) => {
    const row = { year: y };
    for (const s of series) {
      const f = s.data.find((d) => d.year === y);
      row[s.name] = f?.value ?? null;
    }
    return row;
  });
}
const fmtNumber = (n) => {
  if (n == null || !isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return Number(n).toLocaleString();
};

/* ====================== Live valuation metrics (TwelveData) ====================== */
async function fetchValuationMetrics(symbolWithSuffix, currency) {
  if (!TWELVE_API_KEY) {
    return { price: 0, fairEV: 0, fairPE: 0, fairPS: 0, weighted: 0, bookValue: 0, grossMargin: 0, netMargin: 0, opMargin: 0, currency };
  }
  const base = 'https://api.twelvedata.com';
  const key = TWELVE_API_KEY;
  const enc = (s) => encodeURIComponent(s);

  const [priceResp, statsResp, bsResp, isResp] = await Promise.all([
    fetch(`${base}/price?symbol=${enc(symbolWithSuffix)}&apikey=${key}`),
    fetch(`${base}/statistics?symbol=${enc(symbolWithSuffix)}&apikey=${key}`),
    fetch(`${base}/balance_sheet?symbol=${enc(symbolWithSuffix)}&apikey=${key}`),
    fetch(`${base}/income_statement?symbol=${enc(symbolWithSuffix)}&apikey=${key}`),
  ]);

  const priceJson = await priceResp.json();
  const statsJson = await statsResp.json();
  const bsJson = await bsResp.json();
  const isJson = await isResp.json();

  const asNum = (x) => {
    if (x == null) return 0;
    if (typeof x === 'number') return x;
    if (typeof x === 'string') { const n = parseFloat(x.replace(/,/g, '')); return isFinite(n) ? n : 0; }
    return 0;
  };

  const price = asNum(priceJson?.price);
  const stats = statsJson?.statistics || {};
  const bs0 = Array.isArray(bsJson?.balance_sheet) ? bsJson.balance_sheet[0] : {};
  const is0 = Array.isArray(isJson?.income_statement) ? isJson.income_statement[0] : {};

  const enterpriseValue  = asNum(stats?.valuations_metrics?.enterprise_value);
  const sharesOutstanding= asNum(stats?.stock_statistics?.shares_outstanding);
  const cash             = asNum(bs0?.assets?.current_assets?.cash);
  const longTermDebt     = asNum(bs0?.liabilities?.non_current_liabilities?.long_term_debt);
  const forwardPE        = asNum(stats?.valuations_metrics?.forward_pe);
  const netIncome        = asNum(is0?.net_income);
  const priceToSales     = asNum(stats?.valuations_metrics?.price_to_sales_ttm);
  const sales            = asNum(is0?.sales);

  let fairEV = 0, fairPE = 0, fairPS = 0;
  if (sharesOutstanding > 0) {
    fairEV = (enterpriseValue - longTermDebt + cash) / sharesOutstanding;
    fairPE = (forwardPE * netIncome) / sharesOutstanding;
    fairPS = (priceToSales * sales) / sharesOutstanding;
  }
  const weighted    = fairEV * 0.5 + fairPE * 0.25 + fairPS * 0.25;
  const bookValue   = asNum(stats?.financials?.balance_sheet?.book_value_per_share_mrq);
  const grossMargin = asNum(stats?.financials?.gross_margin) * 100;
  const netMargin   = asNum(stats?.financials?.profit_margin) * 100;
  const opMargin    = asNum(stats?.financials?.operating_margin) * 100;

  return { price, fairEV, fairPE, fairPS, weighted, bookValue, grossMargin, netMargin, opMargin, currency };
}

/* ================================== UI bits ================================== */
const Card = ({ title, children }) => (
  <section className="bg-white rounded-2xl shadow p-4">
    {title && <h2 className="font-semibold mb-3">{title}</h2>}
    {children}
  </section>
);

function ChartLines({ series }) {
  const merged = mergeSeries(series);
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={merged} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" />
          <YAxis />
          <Tooltip />
          <Legend />
          {series.map((s, i) => (
            <Line key={i} type="monotone" dataKey={s.name} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
function ChartBars({ data, suffix }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" />
          <YAxis tickFormatter={(v) => `${v}${suffix || ''}`} />
          <Tooltip formatter={(v) => `${v}${suffix || ''}`} />
          <Legend />
          <Bar dataKey="value" name="YoY Growth" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function Table({ data, columns }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            {columns.map((c) => (<th key={c.key} className="py-2 pr-4">{c.label}</th>))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx} className="border-b">
              {columns.map((c) => (
                <td key={c.key} className="py-2 pr-4">{c.fmt ? c.fmt(row[c.key]) : row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ================================== App ================================== */
export default function App() {
  const [companies, setCompanies] = useState([]);
  const [selectedKey, setSelectedKey] = useState(''); // e.g. NASDAQ:AAPL
  const [targetPE, setTargetPE] = useState(TARGET_PE_DEFAULT);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // live metrics
  const [metrics, setMetrics] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFV, setAiFV] = useState(null);
  const [aiError, setAiError] = useState('');
  const [aiCached, setAiCached] = useState(false);
  const [longWait, setLongWait] = useState(false);

  // Progress bar CSS (used when AI is busy)
  const progressCss = `
    @keyframes trueprice-progress { 0%{transform:translateX(-100%)} 50%{transform:translateX(-20%)} 100%{transform:translateX(100%)} }
  `;

  // Load companies.json
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const r = await fetch(`${DATA_URL}?ts=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`Failed to load ${DATA_URL}: ${r.status}`);
        const j = await r.json();
        const list = Array.isArray(j.companies) ? j.companies : [];
        setCompanies(list);
        if (list.length) setSelectedKey(`${list[0].exchange}:${list[0].ticker}`);
      } catch (e) {
        setError(e.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const company = useMemo(() => {
    if (!selectedKey || !companies.length) return null;
    const [ex, tk] = selectedKey.split(':');
    return companies.find((c) => c.exchange === ex && c.ticker === tk) || null;
  }, [selectedKey, companies]);

  const rows = useMemo(() => normalizeFinancialRows(company?.rows || []), [company]);
  const charts = useMemo(() => ({
    revenue: rows.map((r) => ({ year: r.year, value: r.revenue })),
    operatingIncome: rows.map((r) => ({ year: r.year, value: r.operatingIncome })),
    netIncome: rows.map((r) => ({ year: r.year, value: r.netIncome })),
  }), [rows]);
  const growth = useMemo(() => calcGrowth(rows), [rows]);
  const fair = useMemo(() => computeFairValuePerYear(rows, Number(targetPE) || 0), [rows, targetPE]);

  // Fetch live metrics when company changes
  useEffect(() => {
    (async () => {
      setMetrics(null); setAiFV(null); setAiError(''); setAiCached(false);
      if (!company) return;
      const symbol = `${company.ticker}${MARKET_SUFFIX_US}`;
      const data = await fetchValuationMetrics(symbol, MARKET_CCY_US);
      setMetrics(data);
    })();
  }, [company]);

  // Optional: warm-up WebLLM (won’t crash if not installed)
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
      loadCreateMLCEngine().then(() => getEngine()).catch(() => {});
    }
  }, []);

  // ASK AI — cache → WebLLM → OpenAI → local
  async function askAI() {
    if (!metrics || aiBusy) return;

    setAiError('');
    setAiFV(null);
    setAiBusy(true);

    // long-wait hint after 15s (first WebLLM load)
    const waitTimer = setTimeout(() => { if (aiBusy) setLongWait(true); }, 15000);

    try {
      const symbol = `${company.ticker}${MARKET_SUFFIX_US}`;
      const sig = aiInputsSig(metrics);
      const key = AI_CACHE_KEY(symbol, sig);

      // 1) cache
      const cached = cacheRead(key, null);
      if (cached && Date.now() - cached.at < AI_TTL_MS && Number.isFinite(cached.fv)) {
        setAiFV(cached.fv); setAiCached(true);
        return;
      }
      setAiCached(false);

      const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

      // 2) WebLLM
      if (hasWebGPU) {
        try {
          const eng = await getEngine(); // may throw if not installed/failed
          const sys = 'You are a careful equity analyst. Output strict JSON only with key: fv (number). Do not add any text outside JSON.';
          const user = [
            `Compute FV per share using: FV = 0.5*EV + 0.25*PE + 0.25*PS.`,
            `Inputs:`,
            `EV_per_share=${metrics.fairEV.toFixed(2)}`,
            `PE_per_share=${metrics.fairPE.toFixed(2)}`,
            `PS_per_share=${metrics.fairPS.toFixed(2)}`,
            `BookValue_per_share=${metrics.bookValue.toFixed(2)}`,
            `Current_Price=${metrics.price.toFixed(2)}`,
            `Return JSON like: {"fv": 123.45}`
          ].join('\n');

          const resp = await eng.chat.completions.create({
            messages: [ { role: 'system', content: sys }, { role: 'user', content: user } ],
            temperature: 0.2, max_tokens: 60
          });
          const content = resp?.choices?.[0]?.message?.content ?? resp?.output_text ?? '';
          const j = extractJSON(content);
          if (j && typeof j.fv === 'number' && isFinite(j.fv)) {
            const fvNum = Number(j.fv);
            setAiFV(fvNum); cacheWrite(key, { at: Date.now(), fv: fvNum });
            return;
          }
          // fallthrough to OpenAI/local
        } catch {/* ignore; continue */}
      }

      // 3) OpenAI (if key provided)
      if (OPENAI_KEY) {
        const body = {
          model: OPENAI_MODEL,
          messages: [
            { role: 'system', content: 'Output strict JSON with only {"fv": number}. No prose.' },
            { role: 'user', content:
              `Compute FV = 0.5*EV + 0.25*PE + 0.25*PS. Return {"fv": number}.\n` +
              `EV=${metrics.fairEV.toFixed(2)}, PE=${metrics.fairPE.toFixed(2)}, PS=${metrics.fairPS.toFixed(2)}, ` +
              `Book=${metrics.bookValue.toFixed(2)}, Price=${metrics.price.toFixed(2)}`
            }
          ],
          temperature: 0.2, max_tokens: 20
        };
        const r = await fetch(`${OPENAI_BASE}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error('api_error');
        const data = await r.json();
        const content = data?.choices?.[0]?.message?.content ?? '';
        const j = extractJSON(content);
        if (j && typeof j.fv === 'number' && isFinite(j.fv)) {
          const fvNum = Number(j.fv);
          setAiFV(fvNum); cacheWrite(key, { at: Date.now(), fv: fvNum });
          return;
        }
        // fallthrough to local
      }

      // 4) Local deterministic fallback (same formula)
      const fvNum = metrics.fairEV * 0.5 + metrics.fairPE * 0.25 + metrics.fairPS * 0.25;
      if (!isFinite(fvNum)) throw new Error('fallback_error');
      setAiFV(Number(fvNum.toFixed(2)));
      cacheWrite(key, { at: Date.now(), fv: Number(fvNum.toFixed(2)) });

    } catch {
      setAiError('Something went wrong. Try again later.');
    } finally {
      clearTimeout(waitTimer);
      setAiBusy(false);
      setLongWait(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <style>{progressCss}</style>

      <header className="px-6 py-4 shadow bg-white">
        <h1 className="text-2xl font-bold">Trueprice.cash — AAPL/MSFT (Static JSON + Live FV)</h1>
        <p className="text-sm text-gray-600">
          Pick a company, view charts from JSON, and compare Weighted Fair Value (EV/PE/PS) with optional AI estimate.
        </p>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        <section className="bg-white rounded-2xl shadow p-4">
          <div className="grid md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-2">
              <label className="block text-sm mb-1">Company</label>
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="border rounded p-2 w-full"
                disabled={loading || !companies.length}
              >
                {companies.map((c) => (
                  <option key={`${c.exchange}:${c.ticker}`} value={`${c.exchange}:${c.ticker}`}>
                    {c.ticker} ({c.exchange})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Source: <code>{DATA_URL}</code></p>
            </div>

            <div>
              <label className="block text-sm mb-1">Target P/E (per-year FV table)</label>
              <input
                type="number"
                min={0}
                value={targetPE}
                onChange={(e) => setTargetPE(e.target.value)}
                className="border rounded p-2 w-full"
              />
            </div>

            {error && <div className="text-red-600 text-sm">{error}</div>}
          </div>
        </section>

        {!!rows.length && (
          <>
            <Card title="Meta">
              <p className="text-sm text-gray-700">
                <strong>Ticker:</strong> {company?.ticker || '—'} &nbsp; | &nbsp;
                <strong>Exchange:</strong> {company?.exchange || '—'} &nbsp; | &nbsp;
                <strong>Years:</strong> {rows.map((r) => r.year).join(', ')}
              </p>
            </Card>

            {/* Charts */}
            <section className="grid md:grid-cols-2 gap-6">
              <Card title={`Revenue (${company?.ticker || '—'})`}>
                <ChartLines series={[{ name: 'Revenue', data: charts.revenue }]} />
              </Card>
              <Card title="Operating Income">
                <ChartLines series={[{ name: 'Operating Income', data: charts.operatingIncome }]} />
              </Card>
              <Card title="Net Income">
                <ChartLines series={[{ name: 'Net Income', data: charts.netIncome }]} />
              </Card>
              <Card title="Revenue YoY Growth">
                <ChartBars
                  data={growth.map((g) => ({
                    year: g.year,
                    value: g.growth != null ? Number((g.growth * 100).toFixed(2)) : null
                  }))}
                  suffix="%"
                />
              </Card>
            </section>

            {/* Per-year FV from JSON rows */}
            <Card title={`Fair Value per Year (PE=${targetPE})`}>
              <Table
                data={fair}
                columns={[
                  { key: 'year', label: 'Year' },
                  { key: 'equityValue', label: 'Fair Value (Equity)', fmt: (v) => fmtNumber(v) },
                  { key: 'fairValuePerShare', label: 'Fair Value / Share', fmt: (v) => (v ? fmtNumber(v) : '—') }
                ]}
              />
            </Card>

            {/* Weighted FV & Ask AI (uses TwelveData/AI if available) */}
            {metrics && (
              <Card title="Weighted Fair Value (EV/PE/PS) & AI">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2 relative" aria-busy={aiBusy}>
                    {aiBusy && (
                      <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] z-10 pointer-events-auto" aria-hidden="true">
                        <div className="absolute left-0 top-0 h-1 w-full overflow-hidden bg-gray-200" role="progressbar" aria-label="AI is thinking">
                          <div className="h-full w-1/3 bg-gray-800" style={{ animation: 'trueprice-progress 1.2s ease-in-out infinite' }} />
                        </div>
                      </div>
                    )}

                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-xs text-gray-500">Price</div>
                        <div className="text-2xl font-bold">{metrics.price.toFixed(2)} USD</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500">Weighted FV</div>
                        <div className="text-xl font-semibold">{metrics.weighted.toFixed(2)} USD</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-gray-500">EV/share</div>
                        <div className="text-lg font-medium">{metrics.fairEV.toFixed(2)} USD</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-gray-500">PE/share</div>
                        <div className="text-lg font-medium">{metrics.fairPE.toFixed(2)} USD</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-gray-500">PS/share</div>
                        <div className="text-lg font-medium">{metrics.fairPS.toFixed(2)} USD</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-gray-500">Book/share</div>
                        <div className="text-lg font-medium">{metrics.bookValue.toFixed(2)} USD</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button onClick={askAI} disabled={aiBusy} className="bg-black text-white rounded px-4 py-2 disabled:opacity-50">
                        {aiBusy ? 'Thinking…' : 'Ask AI'}
                      </button>
                      {longWait && aiBusy && (
                        <span className="text-xs text-gray-500">First run can take up to a minute while the model loads…</span>
                      )}
                      {!TWELVE_API_KEY && (
                        <span className="text-xs text-amber-700">TwelveData key not set — using zeros/local where needed.</span>
                      )}
                    </div>

                    {aiFV != null && (
                      <div className="rounded-lg border bg-gray-50 p-3 text-sm">
                        <strong>AI fair value:</strong> {aiFV.toFixed(2)} USD
                        {aiCached && <span className="ml-2 text-gray-500 text-xs">(from cache)</span>}
                      </div>
                    )}
                    {aiError && <div className="text-sm text-red-600">{aiError}</div>}
                  </div>
                </div>

                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4">
                  ⚠️ Disclaimer: This is not investment advice.
                </div>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}

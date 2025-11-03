import React, { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';

/**
 * Option B — Static JSON datasets
 * Put your files under: web/public/data/
 * Example: web/public/data/NASDAQ_TSLA.json
 * Format: { "ticker":"TSLA", "exchange":"NASDAQ", "rows":[ {year, revenue, operatingIncome, netIncome, sharesOutstanding?}, ... ] }
 */
const DATASETS = [
  { label: 'TSLA (NASDAQ)', path: '/data/NASDAQ_TSLA.json' },
  // Add more here, e.g.:
  // { label: 'AAPL (NASDAQ)', path: '/data/NASDAQ_AAPL.json' },
  // { label: 'MSFT (NASDAQ)', path: '/data/NASDAQ_MSFT.json' },
];

export default function App() {
  const [datasetPath, setDatasetPath] = useState(DATASETS[0]?.path || '');
  const [ticker, setTicker] = useState('TSLA');
  const [exchange, setExchange] = useState('NASDAQ');
  const [targetPE, setTargetPE] = useState(25);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadDataset() {
    try {
      setLoading(true);
      setError('');
      setRows([]);

      if (!datasetPath) throw new Error('No dataset selected');
      const r = await fetch(datasetPath, { cache: 'no-store' });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`Failed to load ${datasetPath}: ${r.status} ${txt}`);
      }
      const j = await r.json();
      // Expect j = { ticker, exchange, rows: [...] }
      const cleaned = normalizeFinancialRows(j.rows || []);
      setRows(cleaned);
      setTicker(j.ticker || '—');
      setExchange(j.exchange || '—');
    } catch (e) {
      setError(e.message || 'Failed to load dataset');
    } finally {
      setLoading(false);
    }
  }

  // Build chart series
  const charts = useMemo(() => ({
    revenue: rows.map(r => ({ year: r.year, value: r.revenue })),
    operatingIncome: rows.map(r => ({ year: r.year, value: r.operatingIncome })),
    netIncome: rows.map(r => ({ year: r.year, value: r.netIncome })),
  }), [rows]);

  const growth = useMemo(() => calcGrowth(rows), [rows]);
  const fair = useMemo(() => computeFairValuePerYear(rows, Number(targetPE) || 0), [rows, targetPE]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="px-6 py-4 shadow bg-white">
        <h1 className="text-2xl font-bold">AI Stock Report (Static JSON mode)</h1>
        <p className="text-sm text-gray-600">
          Loads pre-generated JSON files from <code>/public/data</code> — no server required.
        </p>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        <section className="bg-white rounded-2xl shadow p-4">
          <h2 className="font-semibold mb-3">Data Source</h2>
          <div className="grid md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-2">
              <label className="block text-sm mb-1">Dataset file</label>
              <select
                value={datasetPath}
                onChange={e => setDatasetPath(e.target.value)}
                className="border rounded p-2 w-full"
              >
                {DATASETS.map(d => (
                  <option key={d.path} value={d.path}>{d.label} — {d.path}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Files must exist in <code>web/public/data/</code>, e.g. <code>/data/NASDAQ_TSLA.json</code>
              </p>
            </div>

            <div>
              <label className="block text-sm mb-1">Target P/E</label>
              <input
                type="number" min={0} value={targetPE}
                onChange={e => setTargetPE(e.target.value)}
                className="border rounded p-2 w-full"
              />
            </div>

            <div>
              <button
                onClick={loadDataset}
                className="bg-black text-white rounded px-4 py-2 w-full disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Load Dataset'}
              </button>
              {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            </div>
          </div>
        </section>

        {!!rows.length && (
          <>
            <section className="bg-white rounded-2xl shadow p-4">
              <h2 className="font-semibold mb-1">Meta</h2>
              <p className="text-sm text-gray-700">
                <strong>Ticker:</strong> {ticker} &nbsp; | &nbsp;
                <strong>Exchange:</strong> {exchange} &nbsp; | &nbsp;
                <strong>Years:</strong> {rows.map(r => r.year).join(', ')}
              </p>
            </section>

            <section className="grid md:grid-cols-2 gap-6">
              <Card title={`Revenue (${ticker})`}>
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
                  data={growth.map(g => ({
                    year: g.year,
                    value: g.growth != null ? Number((g.growth * 100).toFixed(2)) : null
                  }))}
                  suffix="%"
                />
              </Card>
            </section>

            <Card title={`Fair Value per Year (PE=${targetPE})`}>
              <Table
                data={fair}
                columns={[
                  { key: 'year', label: 'Year' },
                  { key: 'equityValue', label: 'Fair Value (Equity)', fmt: (v) => fmtNumber(v) },
                  { key: 'fairValuePerShare', label: 'Fair Value / Share', fmt: (v) => v ? fmtNumber(v) : '—' }
                ]}
              />
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

/* ---------------- Helpers (same math as the server) ---------------- */

function normalizeFinancialRows(arr) {
  // Ensure array of objects with year, revenue, operatingIncome, netIncome, sharesOutstanding?
  const out = [];
  for (const r of arr) {
    const m = lowerMap(r);
    const year = num(m.get('year'));
    const revenue = num(m.get('revenue') ?? m.get('sales'));
    const op = num(m.get('operatingincome') ?? m.get('operating_income'));
    const net = num(m.get('netincome') ?? m.get('net_income'));
    const shares = m.has('sharesoutstanding') ? num(m.get('sharesoutstanding')) : null;
    if (!Number.isFinite(year)) continue;
    out.push({
      year,
      revenue,
      operatingIncome: op,
      netIncome: net,
      sharesOutstanding: shares
    });
  }
  out.sort((a, b) => a.year - b.year);
  return out;
}

function lowerMap(obj) {
  const m = new Map();
  for (const [k, v] of Object.entries(obj || {})) {
    m.set(String(k || '').trim().toLowerCase(), v);
  }
  return m;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function calcGrowth(series) {
  const out = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const curr = series[i];
    if (Number.isFinite(prev?.revenue) && Number.isFinite(curr?.revenue)) {
      const g = (curr.revenue - prev.revenue) / prev.revenue;
      out.push({ year: curr.year, growth: g });
    } else {
      out.push({ year: curr.year, growth: null });
    }
  }
  return out;
}

function computeFairValuePerYear(rows, targetPE) {
  return rows.map((r) => {
    const equityValue = Number.isFinite(r.netIncome) ? r.netIncome * targetPE : null;
    const perShare =
      r.sharesOutstanding && equityValue != null ? equityValue / r.sharesOutstanding : null;
    return { year: r.year, equityValue, fairValuePerShare: perShare };
  });
}

function fmtNumber(n) {
  if (n == null || !isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return Number(n).toLocaleString();
}

/* ---------------- UI bits ---------------- */

function Card({ title, children }) {
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <h2 className="font-semibold mb-3">{title}</h2>
      {children}
    </div>
  );
}

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
            {columns.map((c) => (
              <th key={c.key} className="py-2 pr-4">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx} className="border-b">
              {columns.map((c) => (
                <td key={c.key} className="py-2 pr-4">
                  {c.fmt ? c.fmt(row[c.key]) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

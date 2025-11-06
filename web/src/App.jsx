import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';

const DATA_URL = '/data/companies.json'; // single file with multiple companies

export default function App() {
  const [companies, setCompanies] = useState([]);       // [{ticker, exchange, rows:[]}, ...]
  const [selectedKey, setSelectedKey] = useState('');   // e.g., 'NASDAQ:AAPL'
  const [targetPE, setTargetPE] = useState(25);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Load companies.json on mount
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const r = await fetch(DATA_URL, { cache: 'no-store' });
        if (!r.ok) throw new Error(`Failed to load ${DATA_URL}: ${r.status}`);
        const j = await r.json();
        const list = Array.isArray(j.companies) ? j.companies : [];
        setCompanies(list);
        if (list.length) {
          const first = list[0];
          setSelectedKey(keyOf(first.exchange, first.ticker));
        }
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
    return companies.find(c => c.exchange === ex && c.ticker === tk) || null;
  }, [selectedKey, companies]);

  const rows = useMemo(() => normalizeFinancialRows(company?.rows || []), [company]);
  const growth = useMemo(() => calcGrowth(rows), [rows]);
  const fair = useMemo(() => computeFairValuePerYear(rows, Number(targetPE) || 0), [rows, targetPE]);

  const charts = useMemo(() => ({
    revenue: rows.map(r => ({ year: r.year, value: r.revenue })),
    operatingIncome: rows.map(r => ({ year: r.year, value: r.operatingIncome })),
    netIncome: rows.map(r => ({ year: r.year, value: r.netIncome })),
  }), [rows]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="px-6 py-4 shadow bg-white">
        <h1 className="text-2xl font-bold">AI Stock Report (Static JSON • Multi-company)</h1>
        <p className="text-sm text-gray-600">
          Loads multiple companies from <code>/public/data/companies.json</code> — no server required.
        </p>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        <section className="bg-white rounded-2xl shadow p-4">
          <h2 className="font-semibold mb-3">Data Source</h2>
          <div className="grid md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-2">
              <label className="block text-sm mb-1">Company</label>
              <select
                value={selectedKey}
                onChange={e => setSelectedKey(e.target.value)}
                className="border rounded p-2 w-full"
                disabled={loading || !companies.length}
              >
                {companies.map(c => (
                  <option key={keyOf(c.exchange, c.ticker)} value={keyOf(c.exchange, c.ticker)}>
                    {c.ticker} ({c.exchange})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                File: <code>{DATA_URL}</code>
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
              {error && <p className="text-red-600 text-sm">{error}</p>}
              {loading && <p className="text-sm text-gray-600">Loading…</p>}
            </div>
          </div>
        </section>

        {!!rows.length && (
          <>
            <section className="bg-white rounded-2xl shadow p-4">
              <h2 className="font-semibold mb-1">Meta</h2>
              <p className="text-sm text-gray-700">
                <strong>Ticker:</strong> {company?.ticker || '—'} &nbsp; | &nbsp;
                <strong>Exchange:</strong> {company?.exchange || '—'} &nbsp; | &nbsp;
                <strong>Years:</strong> {rows.map(r => r.year).join(', ')}
              </p>
            </section>

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

/* ---------------- Helpers ---------------- */

function keyOf(exchange, ticker) {
  return `${exchange}:${ticker}`;
}

function normalizeFinancialRows(arr) {
  // arr is already structured in our JSON, but normalize just in case.
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

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function numOrNull(v) {
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

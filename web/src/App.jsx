
import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';

const API_BASE = '/api';
console.log("Using API:", API_BASE);

export default function App() {
  const [ticker, setTicker] = useState('TSLA');
  const [exchange, setExchange] = useState('NASDAQ');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  async function submit(e){
    e.preventDefault();
    setLoading(true); setError(''); setData(null);
    try {
      const r = await fetch(`${API_BASE}/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, exchange })
      });
      if(!r.ok){
        const er = await r.json().catch(()=>({error:'Unknown error'}));
        throw new Error(er.error || 'Request failed');
      }
      const j = await r.json();
      setData(j);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const revenue = data?.charts?.revenue || [];
  const op = data?.charts?.operatingIncome || [];
  const net = data?.charts?.netIncome || [];
  const growth = data?.growth || [];
  const fair = data?.fairValues || [];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="px-6 py-4 shadow bg-white">
        <h1 className="text-2xl font-bold">AI Stock Report</h1>
        <p className="text-sm text-gray-600">Charts for Sales, Operating Income, Net Income (2020-2024) + Fair Value per year.</p>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        <form onSubmit={submit} className="flex flex-wrap gap-3 items-end mb-6">
          <div>
            <label className="block text-sm mb-1">Ticker</label>
            <input value={ticker} onChange={e=>setTicker(e.target.value.toUpperCase())} className="border rounded p-2" placeholder="TSLA" />
          </div>
          <div>
            <label className="block text-sm mb-1">Exchange</label>
            <input value={exchange} onChange={e=>setExchange(e.target.value.toUpperCase())} className="border rounded p-2" placeholder="NASDAQ" />
          </div>
          <button type="submit" className="bg-black text-white rounded px-4 py-2 disabled:opacity-50" disabled={loading}>
            {loading ? 'Loading…' : 'Get Report'}
          </button>
          {error && <span className="text-red-600 ml-2">{error}</span>}
        </form>

        {data && (
          <section className="space-y-8">
            <div className="grid md:grid-cols-2 gap-6">
              <Card title={`Revenue (${data.meta.ticker})`}>
                <ChartLines series={[{ name:'Revenue', data: revenue }]} />
              </Card>
              <Card title="Operating Income">
                <ChartLines series={[{ name:'Operating Income', data: op }]} />
              </Card>
              <Card title="Net Income">
                <ChartLines series={[{ name:'Net Income', data: net }]} />
              </Card>
              <Card title="Revenue YoY Growth">
                <ChartBars data={growth.map(g=>({ year: g.year, value: g.growth != null ? Number((g.growth*100).toFixed(2)) : null }))} suffix="%" />
              </Card>
            </div>

            <Card title={`Fair Value per Year (PE=${data.meta.targetPE})`}>
              <Table data={fair} columns={[
                { key:'year', label:'Year' },
                { key:'equityValue', label:'Fair Value (Equity, $m)', fmt:(v)=>fmtNumber(v) },
                { key:'fairValuePerShare', label:'Fair Value / Share', fmt:(v)=>v?fmtNumber(v):'—' }
              ]} />
            </Card>

            {data.aiNarrative && (
              <Card title="AI Narrative">
                <div className="prose max-w-none whitespace-pre-wrap">{data.aiNarrative}</div>
              </Card>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function fmtNumber(n){
  if(n==null || !isFinite(n)) return '—';
  if(Math.abs(n) >= 1e9) return (n/1e9).toFixed(2)+'B';
  if(Math.abs(n) >= 1e6) return (n/1e6).toFixed(2)+'M';
  if(Math.abs(n) >= 1e3) return (n/1e3).toFixed(2)+'K';
  return Number(n).toLocaleString();
}

function Card({ title, children }){
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <h2 className="font-semibold mb-3">{title}</h2>
      {children}
    </div>
  );
}

function ChartLines({ series }){
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
          {series.map((s, i)=>(
            <Line key={i} type="monotone" dataKey={s.name} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartBars({ data, suffix }){
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" />
          <YAxis tickFormatter={(v)=>`${v}${suffix||''}`} />
          <Tooltip formatter={(v)=>`${v}${suffix||''}`} />
          <Legend />
          <Bar dataKey="value" name="YoY Growth" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Table({ data, columns }){
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            {columns.map(c=> <th key={c.key} className="py-2 pr-4">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx)=> (
            <tr key={idx} className="border-b">
              {columns.map(c=> <td key={c.key} className="py-2 pr-4">{c.fmt?c.fmt(row[c.key]):row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function mergeSeries(series){
  const years = Array.from(new Set(series.flatMap(s=>s.data.map(d=>d.year)))).sort();
  return years.map(y=>{
    const row = { year: y };
    for (const s of series) {
      const f = s.data.find(d=>d.year===y);
      row[s.name] = f?.value ?? null;
    }
    return row;
  });
}

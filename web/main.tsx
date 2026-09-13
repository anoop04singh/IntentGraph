import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, ArrowRight, Check, Copy, Terminal, LockKeyhole, Braces, Network, Zap, Menu, X, ChevronDown, ExternalLink } from 'lucide-react';
import './styles.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/jetbrains-mono/400.css';

type Stats = { paymentsSettled: number; queriesMade: number; queriesSucceeded: number; toolCalls: number; volumeTinybars: string; activeSessions: number; updatedAt: string; service: string; priceTinybars: string; accessSeconds: number; queryLimit: number; toolCallLimit: number; recent: { tool: string; success: number; durationMs: number; createdAt: string }[]; daily: { day: string; queries: number }[] };
const hbar = (tiny: string) => { const n = BigInt(tiny); return `${n / 100000000n}.${(n % 100000000n).toString().padStart(8, '0')}`.replace(/\.?0+$/, ''); };
const fmt = (n?: number) => n === undefined ? '—' : new Intl.NumberFormat('en-US').format(n);
function Mark() { return <svg viewBox="0 0 36 36" aria-hidden="true"><path d="M7 28 18 7 29 28ZM18 7v21M7 28h22"/><circle cx="18" cy="7" r="3"/><circle cx="7" cy="28" r="3"/><circle cx="29" cy="28" r="3"/></svg>; }
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState('');
  useEffect(() => { if (state) { const t = setTimeout(() => setState(''), 2500); return () => clearTimeout(t); } }, [state]);
  return <button className="copy" onClick={async () => { try { await navigator.clipboard.writeText(text); setState('Copied'); } catch { setState('Select and copy the text'); } }} aria-label={label}>{state === 'Copied' ? <Check size={15}/> : <Copy size={15}/>}<span aria-live="polite">{state || label}</span></button>;
}
function GraphDiagram() {
  return <div className="graph-visual" aria-label="An agent connects through the payment gate to The Graph's subgraph tools">
    <div className="diagram-caption mono">A SINGLE CONNECTION. AN OPEN DATA WORLD.</div>
    <svg viewBox="0 0 560 390" className="graph-svg" role="img" aria-label="Agent to IntentGraph to subgraphs">
      <defs><pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#afafa1"/></pattern></defs>
      <rect width="560" height="390" fill="url(#dots)"/>
      <g stroke="#babdb0" fill="none" strokeWidth="1.2"><path d="M72 200H248M292 200 402 94M292 200 474 200M292 200 402 312M402 94 474 200 402 312M402 94 526 90M474 200 531 286M402 312 486 362M402 94 380 35M402 312 343 365"/><path d="M72 200 34 125M72 200 34 275"/></g>
      <g fill="#f6f5f0" stroke="#949989"><circle cx="402" cy="94" r="25"/><circle cx="474" cy="200" r="25"/><circle cx="402" cy="312" r="25"/>{[[526,90],[531,286],[486,362],[380,35],[343,365],[34,125],[34,275]].map(([cx,cy],i)=><circle key={i} cx={cx} cy={cy} r="6"/>)}</g>
      <rect x="40" y="168" width="64" height="64" rx="13" fill="#f6f5f0" stroke="#676d5e"/>
      <path d="M59 191 51 200 59 209M85 191 93 200 85 209M76 188 68 212" stroke="#33382d" strokeWidth="2" fill="none"/>
      <circle cx="267" cy="200" r="55" fill="#f6f5f0" stroke="#c4c7bb"/><circle cx="267" cy="200" r="43" fill="#252d23"/>
      <g fill="none" stroke="#dcf7a4" strokeWidth="2"><path d="M249 215 267 183 285 215ZM267 183v32"/><circle cx="267" cy="183" r="4"/><circle cx="249" cy="215" r="4"/><circle cx="285" cy="215" r="4"/></g>
      <g fontFamily="monospace" fontSize="17" fill="#33382d" textAnchor="middle"><text x="402" y="100">⌕</text><text x="474" y="205">{'{ }'}</text><text x="402" y="318">↗</text></g>
      <g fontFamily="monospace" fontSize="11" fill="#676d5e" textAnchor="middle"><text x="72" y="257">YOUR AGENT</text><text x="267" y="275">INTENTGRAPH</text><text x="402" y="136">DISCOVER</text><text x="474" y="242">SCHEMA</text><text x="402" y="354">QUERY</text></g>
      <circle r="3" fill="#6c8745"><animateMotion dur="4s" repeatCount="indefinite" path="M104 200H215"/></circle>
      <circle r="3" fill="#6c8745"><animateMotion dur="5s" repeatCount="indefinite" path="M311 200 380 108"/></circle>
    </svg>
    <div className="diagram-foot"><span><LockKeyhole size={12}/> x402 payment gate</span><span>POWERED BY THE GRAPH ↗</span></div>
  </div>;
}
const steps = [
  { icon: Terminal, title: 'Bring your intent.', text: 'Connect your agent to IntentGraph. Ask for the on-chain data you need, in your own words.', tag: '01 / CONNECT' },
  { icon: Zap, title: 'Pay. Unlock. Go.', text: 'Your agent requests a quote and signs an HBAR payment. Once settled, the data tools appear.', tag: '02 / UNLOCK' },
  { icon: Braces, title: 'Let your agent reason.', text: 'Discover subgraphs, verify activity, inspect schemas, and query. Your agent turns the results into answers.', tag: '03 / EXPLORE' },
];
function App() {
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState(false);
  const [mcpUrl, setMcpUrl] = useState('');
  const [menu, setMenu] = useState(false);
  const [client, setClient] = useState('Claude Desktop');
  const [period, setPeriod] = useState('All time');
  useEffect(() => {
    const controller = new AbortController(); let disposed = false;
    async function refresh() {
      try { const res = await fetch('/api/stats', { signal: controller.signal }); if (!res.ok) throw new Error(); const json = await res.json(); if (!disposed) { setStats(json); setError(false); } }
      catch { if (!disposed) setError(true); }
    }
    void refresh(); const timer = setInterval(refresh, 10000);
    fetch('/api/config', { signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject()).then(c => { if (!disposed) setMcpUrl(c.mcpUrl); }).catch(() => {});
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, []);
  const endpoint = mcpUrl || `${window.location.origin}/mcp`;
  const snippets: Record<string, string> = {
    'Claude Desktop': JSON.stringify({ mcpServers: { intentgraph: { command: 'npx', args: ['-y', 'mcp-remote', endpoint] } } }, null, 2),
    Cursor: JSON.stringify({ mcpServers: { intentgraph: { url: endpoint } } }, null, 2),
    'VS Code': JSON.stringify({ servers: { intentgraph: { type: 'http', url: endpoint } } }, null, 2),
    'Any agent': `POST ${endpoint}\nTransport: Streamable HTTP\n\n1. Initialize; retain Mcp-Session-Id.\n2. Call unlock_data_access({}).\n3. Sign accepts[0] with an x402 Hedera wallet.\n4. Retry with quote_id + payment_proof.\n5. Refresh tools/list. Search → schema → query.`,
  };
  const price = stats ? hbar(stats.priceTinybars) : '—';
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 6 + i); const key = d.toISOString().slice(0,10); return { label: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), count: stats?.daily.find(x => x.day === key)?.queries ?? 0 }; });
  const weekQueries = days.reduce((s,d) => s + d.count, 0);
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header><nav className="container nav"><a href="#" className="brand"><Mark/>IntentGraph<span className="beta">BETA</span></a><div className={`nav-links ${menu ? 'open' : ''}`}>{[['The protocol','#protocol'],['Live activity','#activity'],['Developers','#developers']].map(([text,href]) => <a key={href} href={href} onClick={()=>setMenu(false)}>{text}</a>)}</div><a className="button small nav-cta" href="#developers">Connect your agent <ArrowUpRight size={15}/></a><button className="menu" aria-label="Toggle navigation" aria-expanded={menu} onClick={()=>setMenu(!menu)}>{menu ? <X/> : <Menu/>}</button></nav></header>
    <main id="main">
      <section className="hero container">
        <div className="hero-copy"><div className="eyebrow"><span className="line"/> ON-CHAIN DATA. AGENT-READY.</div><h1>From intent<br/>to <em>on-chain</em><br/>intelligence.</h1><p>Your agent brings the question. We open the data.<br className="desktop"/> Discover and query The Graph’s subgraphs with a single MCP connection and a small HBAR payment.</p><div className="hero-actions"><a className="button" href="#developers">Connect your agent <ArrowUpRight size={18}/></a><a className="text-link" href="#protocol">See how it works <ArrowRight size={16}/></a></div><div className="hero-note"><Check size={14}/> No Graph API key needed <span>·</span> Pay with HBAR</div></div>
        <div className="hero-right"><div className="testnet-pill"><span/> Built on Hedera testnet</div><GraphDiagram/><div className="intent-example"><span className="mono">TRY AN INTENT</span><p>“Show me the latest large<br/>Uniswap swaps on Ethereum.”</p><a href="#developers" aria-label="Connect an agent to try this intent"><ArrowUpRight size={23}/></a></div></div>
      </section>
      <div className="ecosystem"><div className="container ecosystem-inner"><span className="mono">ONE OPEN STACK</span><span className="partner graph-partner">◉ &nbsp;The Graph</span><span className="partner">ℏ &nbsp;Hedera</span><span className="partner mono">x402<span className="partner-note"> payment protocol</span></span><span className="partner mono">MCP<span className="partner-note"> agent interface</span></span></div></div>
      <section id="activity" className="activity container section"><div className="section-top"><div><div className="eyebrow">01 / NETWORK ACTIVITY</div><h2>Real usage.<br className="mobile"/> <em>Every interaction.</em></h2></div><div className={`live-badge ${error ? 'offline' : ''}`}><span/>{error ? 'Connection interrupted' : stats ? 'Live · refreshes every 10s' : 'Connecting to live stats…'}</div></div>
        {stats?.service === 'setup_required' && <div className="setup-notice">Awaiting operator setup. Activity below is real; payments open when the server’s Graph key and Hedera receiving account are configured.</div>}
        {error && <p role="status" className="error-notice">Live stats are unavailable. {stats ? 'Showing the last received values.' : 'Retrying automatically.'}</p>}
        <div className="stats-grid">{[
          { value: fmt(stats?.paymentsSettled), label: 'Payments settled', foot: 'Confirmed on Hedera testnet' },
          { value: fmt(stats?.queriesMade), label: 'Queries made', foot: `${fmt(stats?.queriesSucceeded)} successful queries` },
          { value: stats ? hbar(stats.volumeTinybars) : '—', label: 'HBAR settled', foot: 'Total confirmed payment volume' },
          { value: fmt(stats?.activeSessions), label: 'Active access passes', foot: 'Independent, paid HTTP sessions' },
        ].map((s,i)=><div className="stat" key={s.label}><span className="mono stat-index">0{i+1}</span><strong>{s.value}</strong><span>{s.label}</span><small>{s.foot}</small></div>)}</div>
        <div className="activity-grid"><div className="activity-feed"><div className="panel-title"><h3>Latest tool activity</h3><span className="mono">{stats ? `${fmt(stats.toolCalls)} TOTAL CALLS` : '—'}</span></div>{stats?.recent.length ? stats.recent.map((r,i)=><div className="activity-row" key={r.createdAt+i}><span className={`result-dot ${r.success ? '' : 'failed'}`}/><div><code>{r.tool}</code><small>{new Date(r.createdAt).toLocaleTimeString()} · {r.durationMs} ms</small></div><span className="mono">{r.success ? 'SUCCESS' : 'FAILED'}</span></div>) : <div className="empty"><Network size={29} strokeWidth={1}/><p>{stats ? 'Your first query starts the story.' : 'Waiting for activity data.'}</p><span>Settled payments and real tool calls appear here.<br/>No simulated activity.</span></div>}</div><div className="chart-panel"><div className="panel-title"><h3>Query volume</h3><label className="sr-only" htmlFor="period">Query volume period</label><select id="period" value={period} onChange={e=>setPeriod(e.target.value)}><option>All time</option><option>Last 7 days</option></select></div><div className="chart-total">{stats ? fmt(period === 'All time' ? stats.queriesMade : weekQueries) : '—'}<span>queries · {period.toLowerCase()}</span></div><div className="bars" aria-label="Daily query counts for the last seven UTC days">{days.map((d,i)=><div className="bar-col" key={i}><div className="bar-slot"><div className="bar" style={{ height: `${d.count ? Math.max(4,d.count / Math.max(1,...days.map(v=>v.count)) * 100) : 0}%` }} title={`${d.label}: ${d.count} queries`}/></div><span>{d.label}</span></div>)}</div><div className="chart-foot mono">LAST 7 DAYS · UTC <span>{stats ? 'UPDATED ' + new Date(stats.updatedAt).toLocaleTimeString() : 'WAITING FOR DATA'}</span></div></div></div>
      </section>
      <section id="protocol" className="protocol section"><div className="container"><div className="section-top"><div><div className="eyebrow">02 / THE PROTOCOL</div><h2>A small payment.<br/><em>A world of answers.</em></h2></div><p className="section-description">No accounts to create. No API keys to manage.<br/>A direct path from your agent to indexed blockchain data.</p></div><div className="steps">{steps.map(s=><article key={s.tag}><div className="step-top"><span className="mono">{s.tag}</span><s.icon size={22} strokeWidth={1.4}/></div><h3>{s.title}</h3><p>{s.text}</p></article>)}</div><div className="protocol-footer"><LockKeyhole size={17}/><p>Tools stay locked until payment settles. Your access is yours alone.</p><span className="mono">VERIFY → SETTLE → ENABLE</span></div></div></section>
      <section id="developers" className="developers container section"><div className="developer-copy"><div className="eyebrow">03 / BUILT FOR YOUR AGENT</div><h2>One connection.<br/><em>Bring your own<br/>curiosity.</em></h2><p>Add IntentGraph to your MCP client. Your agent discovers the tools after payment; our server handles The Graph authentication.</p><div className="check-list"><span><Check size={16}/> Your Graph API key: not required</span><span><Check size={16}/> Search, schema, and GraphQL tools</span><span><Check size={16}/> x402 v2 payments in native HBAR</span></div><a className="text-link" href="https://thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/introduction/" target="_blank" rel="noreferrer">Explore The Graph’s MCP <ExternalLink size={15}/></a></div><div className="integration"><div className="tabs" role="tablist" aria-label="MCP client">{Object.keys(snippets).map(c=><button key={c} role="tab" id={`tab-${c.replaceAll(' ','-')}`} aria-controls="client-panel" aria-selected={client === c} onClick={()=>setClient(c)}>{c}</button>)}</div><div className="code-meta"><span>{client === 'Claude Desktop' ? 'claude_desktop_config.json' : client === 'Cursor' ? '.cursor/mcp.json' : client === 'VS Code' ? '.vscode/mcp.json' : 'connection guide'}</span><CopyButton text={snippets[client]}/></div><pre id="client-panel" role="tabpanel" aria-labelledby={`tab-${client.replaceAll(' ','-')}`}><code>{snippets[client]}</code></pre><div className="integration-note"><Terminal size={18}/><p>{client === 'Claude Desktop' ? 'Requires Node.js 22+. Paste into your MCP config and restart Claude Desktop.' : client === 'Cursor' ? 'Save in your project or global Cursor MCP config, then enable IntentGraph.' : client === 'VS Code' ? 'Save in your workspace MCP config, then start the server from VS Code.' : 'Use an MCP client that supports Streamable HTTP and retain the session header.'}</p></div><details><summary>How does my agent pay? <ChevronDown size={16}/></summary><p>Your agent needs an x402-compatible Hedera wallet with testnet HBAR. The MCP client alone does not sign payments. Call <code>unlock_data_access</code>, sign the returned requirements, then submit <code>quote_id</code> and the base64 <code>payment_proof</code> in the same session.</p><p>Never send private keys to IntentGraph. After settlement, refresh the tool list if your client does not do so automatically.</p></details></div></section>
      <section className="pricing container"><div><div className="eyebrow">SIMPLE, SESSION-BASED ACCESS</div><h2>Less setup.<br/><em>More discovery.</em></h2></div><div className="price-content"><div className="price">{price}<span>HBAR / access pass</span></div><p>{stats ? `${Math.round(stats.accessSeconds / 60)} minutes · Up to ${stats.queryLimit} query attempts · ${stats.toolCallLimit} total tool calls` : 'Loading access limits…'}</p><a href="#developers" className="button">Connect and get a quote <ArrowUpRight size={17}/></a><small>Hedera testnet funds only. Access ends at the time or usage limit, or when your MCP session closes. Data availability varies; failed calls count toward the limit. No automatic refunds.</small></div></section>
    </main><footer className="container"><a className="brand" href="#"><Mark/>IntentGraph</a><span>Intent in. Intelligence out.</span><a href="#developers">Connect your agent <ArrowUpRight size={14}/></a><div className="footer-bottom"><span>© {new Date().getFullYear()} IntentGraph</span><span>Powered by The Graph · Settled on Hedera</span><span className="mono">TESTNET BETA</span></div></footer>
  </>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

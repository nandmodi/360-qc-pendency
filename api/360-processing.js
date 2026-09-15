// api/360-processing.js
const METABASE_URL = 'https://metabase.spyne.ai';
const CARD_ID = 7225;
const CACHE_TTL = 15 * 60 * 1000;

let _cache = null;
let _lastFetch = 0;
let _session = null;
let _sessionTime = 0;
const SESSION_TTL = 55 * 60 * 1000;

const pick = (row, ...keys) => {
  for (const k of keys) {
    const v = row?.[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

const parseDate = v => {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
};

async function getSession(username, password) {
  if (_session && Date.now() - _sessionTime < SESSION_TTL) return _session;
  const r = await fetch(`${METABASE_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!r.ok) throw new Error(`Login failed (${r.status})`);
  const { id } = await r.json();
  if (!id) throw new Error('No session id returned');
  _session = id;
  _sessionTime = Date.now();
  return _session;
}

async function buildCache(username, password) {
  const sessionId = await getSession(username, password);
  const r = await fetch(`${METABASE_URL}/api/card/${CARD_ID}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Metabase-Session': sessionId },
    body: JSON.stringify({})
  });
  if (!r.ok) throw new Error(`Query failed (${r.status})`);
  const result = await r.json();
  const cols = result?.data?.cols || [];
  const rawRows = result?.data?.rows || [];
  const names = cols.map((c, i) => c?.name || c?.display_name || `col_${i}`);
  const rows = rawRows.map(row => {
    const obj = {};
    names.forEach((n, i) => { obj[n] = row[i]; });
    return obj;
  });
  // Exact columns: "t1.sku_id","t1.enterprise_id","enterprise_name","enterprise_version",
  // "created_on","updated_on","source","status","first_qc_done","Age","input_type"
  const normalizedRows = rows.map(r => ({
    sku:             pick(r, 't1.sku_id', 'sku_id', 'spin_sku_id'),
    vin:             '',
    eid:             pick(r, 't1.enterprise_id', 'enterprise_id'),
    entName:         pick(r, 'enterprise_name') || pick(r, 't1.enterprise_id'),
    inputType:       pick(r, 'input_type', 'source'),
    crmStatus:       pick(r, 'status', 'crm_status'),
    firstQcDone:     pick(r, 'first_qc_done'),
    customerSegment: pick(r, 'customer_segment'),
    assignedTeam:    pick(r, 'qc_user', 'assigned_user_name'),
    ageHrs:          pick(r, 'Age', 'age'),
    createdAt:       parseDate(pick(r, 'created_on', 'sku_created_on', 'createdAt')),
    skuCreatedOn:    parseDate(pick(r, 'created_on', 'sku_created_on')),
  }));
  _cache = { rows: normalizedRows, total: normalizedRows.length, lastSynced: new Date().toISOString() };
  _lastFetch = Date.now();
  return _cache;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const username = process.env.METABASE_EMAIL;
  const password = process.env.METABASE_PASSWORD;
  if (!username || !password) return res.status(500).json({ error: 'Metabase credentials not configured.' });

  try {
    const force = req.query.force === '1';
    if (force) { _cache = null; _lastFetch = 0; }
    if (_cache && !force && Date.now() - _lastFetch < CACHE_TTL) {
      return res.status(200).json(_cache);
    }
    const data = await buildCache(username, password);
    return res.status(200).json(data);
  } catch (err) {
    console.error('360 processing error:', err);
    if (_cache) return res.status(200).json({ ..._cache, stale: true });
    return res.status(500).json({ error: err?.message });
  }
}

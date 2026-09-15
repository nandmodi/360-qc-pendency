// api/360-pendency.js
const METABASE_URL = 'https://metabase.spyne.ai';
const CARD_ID = 12588;
const CACHE_TTL = 15 * 60 * 1000; // 15 min

let _cache = null;
let _lastFetch = 0;
let _session = null;
let _sessionTime = 0;
const SESSION_TTL = 55 * 60 * 1000; // 55 min (Metabase sessions last ~1hr)

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
  const normalizedRows = rows.map(r => ({
    sku:             pick(r, 'spin_sku_id', 'sku', 'sku_id'),
    spinId:          pick(r, 'spin_id', 'spinId', 'ss.spin_id'),
    vin:             pick(r, 'vinName', 'vin_name', 'vin'),
    eid:             pick(r, 'enterpriseId', 'enterprise_id'),
    entName:         pick(r, 'enterprise_name', 'enterpriseName') || pick(r, 'enterpriseId'),
    teamId:          pick(r, 'teamId', 'team_id'),
    teamName:        pick(r, 'team_name', 'teamName'),
    customerSegment: pick(r, 'customer_segment', 'customerSegment'),
    crmStatus:       pick(r, 'crm_status', 'crmStatus'),
    assignedTeam:    pick(r, 'qc_user', 'assigned_user_name'),
    entEmail:        pick(r, 'CS') || pick(r, 'OB'),
    entStage:        pick(r, 'stage'),
    finalStatus:     pick(r, 'final_status', 'finalStatus', 'status'),
    inputType:       pick(r, 'input_type', 'inputType'),
    platform:        pick(r, 'platform'),
    make:            pick(r, 'make'), model: pick(r, 'model'), year: pick(r, 'year'),
    thumbnail:       pick(r, 'thumbnail_url', 'thumbnail'),
    vdpUrl:          pick(r, 'vdp_url', 'vdpUrl'),
    imgCount:        Number(pick(r, 'image_count', 'imgCount')) || 0,
    overallScore:    pick(r, 'overall_score', 'overallScore'),
    vinScore:        pick(r, 'vin_score', 'vinScore'),
    createdAt:       parseDate(pick(r, 'createdAt', 'created_at', 'created_on', 'vinCreation')),
    skuCreatedOn:    parseDate(pick(r, 'sku_created_on', 'skuCreatedOn')),
    firstQcDone:     pick(r, 'first_qc_done', 'firstQcDone'),
  }));
  _cache = { rows: normalizedRows, lastSynced: new Date().toISOString() };
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
    // Serve cache if fresh
    if (_cache && !force && Date.now() - _lastFetch < CACHE_TTL) {
      return res.status(200).json(_cache);
    }
    const data = await buildCache(username, password);
    return res.status(200).json(data);
  } catch (err) {
    console.error('360 pendency error:', err);
    // Return stale cache if available
    if (_cache) return res.status(200).json({ ..._cache, stale: true });
    return res.status(500).json({ error: err?.message });
  }
}

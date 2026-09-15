// api/360-pendency.js — with session + response caching
const METABASE_URL = 'https://metabase.spyne.ai';
const CARD_ID = 12588;
const CACHE_TTL = 15 * 60 * 1000;
const SESSION_TTL = 55 * 60 * 1000;

let _cache = null, _lastFetch = 0, _session = null, _sessionTime = 0;

const pick = (row, ...keys) => {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
};

const parseDate = value => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
};

async function getSession(username, password) {
  if (_session && Date.now() - _sessionTime < SESSION_TTL) return _session;
  const r = await fetch(`${METABASE_URL}/api/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Login failed (${r.status}): ${t.slice(0,200)}`); }
  const { id } = await r.json();
  if (!id) throw new Error('No session id returned');
  _session = id; _sessionTime = Date.now(); return _session;
}

async function buildCache(username, password) {
  const sessionId = await getSession(username, password);
  const query = await fetch(`${METABASE_URL}/api/card/${CARD_ID}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Metabase-Session': sessionId },
    body: JSON.stringify({})
  });
  if (!query.ok) { const t = await query.text(); throw new Error(`Query failed (${query.status}): ${t.slice(0,300)}`); }
  const result = await query.json();
  const data = result?.data;
  const columns = data?.cols || [];
  const rawRows = data?.rows || [];
  const names = columns.map((c, i) => c?.name || c?.display_name || c?.field_ref?.[1] || `column_${i}`);
  const rows = rawRows.map(row => {
    const obj = {}; names.forEach((name, i) => { obj[name] = row[i]; }); return obj;
  });
  const normalizedRows = rows.map(r => ({
    sku:             pick(r, 'spin_sku_id', 'sku', 'sku_id', 'SKU ID'),
    spinId:          pick(r, 'spin_id', 'spinId', 'ss.spin_id'),
    vin:             pick(r, 'vinName', 'vin_name', 'vin', 'VIN'),
    eid:             pick(r, 'enterpriseId', 'enterprise_id', 'Ent ID'),
    entName:         pick(r, 'enterprise_name', 'enterpriseName', 'Enterprise', 'enterprise') || pick(r, 'enterpriseId', 'enterprise_id'),
    teamId:          pick(r, 'teamId', 'team_id', 'Team ID'),
    teamName:        pick(r, 'team_name', 'teamName', 'Team'),
    customerSegment: pick(r, 'customer_segment', 'customerSegment', 'Segment'),
    crmStatus:       pick(r, 'crm_status', 'crmStatus', 'CRM Status'),
    assignedTeam:    pick(r, 'qc_user', 'assigned_user_name', 'assignedTeamName', 'QC User'),
    entEmail:        pick(r, 'CS') || pick(r, 'OB'),
    entStage:        pick(r, 'stage', 'Stage'),
    finalStatus:     pick(r, 'final_status', 'finalStatus', 'status', 'Status'),
    inputType:       pick(r, 'input_type', 'inputType', 'Input Type'),
    platform:        pick(r, 'platform', 'Platform'),
    make:            pick(r, 'make', 'Make'),
    model:           pick(r, 'model', 'Model'),
    year:            pick(r, 'year', 'Year'),
    thumbnail:       pick(r, 'thumbnail_url', 'thumbnail', 'Thumbnail'),
    vdpUrl:          pick(r, 'vdp_url', 'vdpUrl', 'VDP URL'),
    imgCount:        Number(pick(r, 'image_count', 'imgCount', 'Image Count')) || 0,
    overallScore:    pick(r, 'overall_score', 'overallScore'),
    vinScore:        pick(r, 'vin_score', 'vinScore'),
    createdAt:       parseDate(pick(r, 'createdAt', 'created_at', 'created_on', 'vinCreation', 'Created At')),
    skuCreatedOn:    parseDate(pick(r, 'sku_created_on', 'skuCreatedOn', 'SKU Created On')),
    firstQcDone:     pick(r, 'first_qc_done', 'firstQcDone', 'First QC Done'),
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
    if (_cache && !force && Date.now() - _lastFetch < CACHE_TTL) return res.status(200).json(_cache);
    const data = await buildCache(username, password);
    return res.status(200).json(data);
  } catch (err) {
    console.error('360 pendency error:', err);
    if (_cache) return res.status(200).json({ ..._cache, stale: true });
    return res.status(500).json({ error: err?.message });
  }
}

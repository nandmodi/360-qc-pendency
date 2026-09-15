// api/360-processing.js
// Fetches AI Processing pending SKUs from Metabase question 7225
const METABASE_URL = 'https://metabase.spyne.ai';
const CARD_ID = 7225;

let _cache = null, _lastFetch = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 min — matches main dashboard

function parseLine(line) {
  const fields = []; let cur = '', inQ = false, i = 0;
  while (i < line.length) {
    const c = line[i];
    if (inQ) { if (c === '"' && line[i+1] === '"') { cur += '"'; i += 2; } else if (c === '"') { inQ = false; i++; } else { cur += c; i++; } }
    else { if (c === '"') { inQ = true; i++; } else if (c === ',') { fields.push(cur.trim()); cur = ''; i++; } else { cur += c; i++; } }
  }
  fields.push(cur.trim()); return fields;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseLine(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = parseLine(line); const obj = {};
    headers.forEach((h, j) => { obj[h] = (vals[j] ?? '').trim(); }); return obj;
  });
}

function pick(r, ...names) {
  for (const n of names) { const v = r[n]; if (v != null && String(v).trim()) return String(v).trim(); } return '';
}

function parseMetaDate(s) {
  if (!s) return null;
  if (s.includes('T') || s.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(s);
  const d = new Date(s.replace(/,/g,'').trim() + ' UTC'); return isNaN(d) ? null : d;
}

async function buildCache(force = false) {
  if (!force && _cache && Date.now() - _lastFetch < CACHE_TTL) return _cache;
  const now = Date.now();

  const username = process.env.METABASE_EMAIL;
  const password = process.env.METABASE_PASSWORD;

  let rows = [];

  if (username && password) {
    // Authenticated API approach
    const login = await fetch(`${METABASE_URL}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!login.ok) throw new Error('Metabase login failed: ' + login.status);
    const { id: sessionId } = await login.json();

    const query = await fetch(`${METABASE_URL}/api/card/${CARD_ID}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Metabase-Session': sessionId },
      body: JSON.stringify({})
    });
    if (!query.ok) throw new Error('Metabase query failed: ' + query.status);
    const result = await query.json();
    const cols = result?.data?.cols || [];
    const rawRows = result?.data?.rows || [];
    const names = cols.map((c, i) => c?.name || c?.display_name || `col_${i}`);
    rows = rawRows.map(row => { const obj = {}; names.forEach((n, i) => { obj[n] = row[i]; }); return obj; });
  } else {
    throw new Error('Metabase credentials not configured');
  }

  const normalized = rows.map(r => {
    const skuCreatedRaw = pick(r, 'sku_created_on', 'skuCreatedOn', 'createdAt', 'created_at');
    const skuCreatedDate = parseMetaDate(skuCreatedRaw);
    return {
      sku:         pick(r, 'spin_sku_id', 'sku_id', 'sku'),
      vin:         pick(r, 'vinName', 'vin_name', 'vin'),
      eid:         pick(r, 'enterpriseId', 'enterprise_id'),
      entName:     pick(r, 'enterprise_name') || pick(r, 'enterpriseId'),
      inputType:   pick(r, 'input_type', 'inputType'),
      crmStatus:   pick(r, 'crm_status', 'crmStatus'),
      assignedTeam: pick(r, 'qc_user', 'assigned_user_name'),
      customerSegment: pick(r, 'customer_segment', 'customerSegment'),
      skuCreatedOn: skuCreatedDate ? skuCreatedDate.toISOString() : skuCreatedRaw,
      createdAt:   skuCreatedDate ? skuCreatedDate.toISOString() : skuCreatedRaw,
    };
  });

  _cache = { rows: normalized, total: normalized.length, lastSynced: new Date(now).toISOString() };
  _lastFetch = now;
  return _cache;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const force = req.query.force === '1';
    if (force) { _cache = null; _lastFetch = 0; }
    const data = await buildCache(force);
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// api/360-pendency.js
// Uses Metabase public CSV — no login required, no rate limiting
const METABASE_CSV_URL = process.env.METABASE_CSV_URL ||
  'https://metabase.spyne.ai/public/question/777eeac8-7d6f-49f9-96d4-499cdea1b891.csv';

const CACHE_TTL = 15 * 60 * 1000;

let _cache = null, _lastFetch = 0;

function parseLine(line) {
  const fields = []; let cur = '', inQ = false, i = 0;
  while (i < line.length) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i += 2; }
      else if (c === '"') { inQ = false; i++; }
      else { cur += c; i++; }
    } else {
      if (c === '"') { inQ = true; i++; }
      else if (c === ',') { fields.push(cur.trim()); cur = ''; i++; }
      else { cur += c; i++; }
    }
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

const pick = (row, ...keys) => {
  for (const key of keys) {
    const v = row?.[key];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

const parseDate = v => {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
};

async function fetchFromMetabase() {
  const r = await fetch(METABASE_CSV_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`CSV fetch failed (${r.status})`);
  const rows = parseCSV(await r.text());
  const normalized = rows.map(r => ({
    sku:             pick(r, 'spin_sku_id', 'sku', 'sku_id'),
    spinId:          pick(r, 'ss.spin_id', 'spin_id'),
    vin:             pick(r, 'vinName', 'vin_name', 'vin'),
    eid:             pick(r, 'enterpriseId', 'enterprise_id'),
    entName:         pick(r, 'enterprise_name') || pick(r, 'enterpriseId'),
    teamId:          pick(r, 'teamId', 'team_id'),
    teamName:        pick(r, 'team_name', 'teamName'),
    customerSegment: pick(r, 'customer_segment', 'customerSegment'),
    crmStatus:       pick(r, 'crm_status', 'crmStatus'),
    assignedTeam:    pick(r, 'qc_user', 'assigned_user_name'),
    entEmail:        pick(r, 'CS') || pick(r, 'OB'),
    entStage:        pick(r, 'stage'),
    finalStatus:     pick(r, 'status', 'final_status'),
    inputType:       pick(r, 'input_type', 'inputType'),
    createdAt:       parseDate(pick(r, 'createdAt', 'created_at', 'created_on')),
    skuCreatedOn:    parseDate(pick(r, 'sku_created_on', 'skuCreatedOn')),
    firstQcDone:     pick(r, 'first_qc_done', 'firstQcDone'),
  }));
  _cache = { rows: normalized, lastSynced: new Date().toISOString() };
  _lastFetch = Date.now();
  return _cache;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const force = req.query.force === '1';
    const auto  = req.query.auto  === '1';

    // force=1 — manual refresh, bust cache
    if (force) { _cache = null; _lastFetch = 0; }

    // auto=1 — auto refresh every 60s, bust cache
    if (auto) { _cache = null; _lastFetch = 0; }

    // Normal fetch — serve cache if < 15 min
    if (_cache && !force && !auto && Date.now() - _lastFetch < CACHE_TTL) {
      return res.status(200).json(_cache);
    }

    const data = await fetchFromMetabase();
    return res.status(200).json(data);
  } catch (err) {
    console.error('360 pendency error:', err);
    if (_cache) return res.status(200).json({ ..._cache, stale: true });
    return res.status(500).json({ error: err?.message });
  }
}

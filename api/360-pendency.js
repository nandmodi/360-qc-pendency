// api/360-pendency.js
// Vercel serverless handler for 360 QC Pendency Dashboard
// Data source: 360 QC Pendency Metabase question
// Pending = crm_status === 'qc_unassigned'

const METABASE_CSV_URL =
  'https://metabase.spyne.ai/public/question/e7c25d62-7cce-40d3-a1e9-a0f7b167ae96.csv';

let _cache = null;
let _lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── CSV parser ─────────────────────────────────────────────────────
function parseLine(line) {
  const fields = [];
  let cur = '', inQ = false, i = 0;
  while (i < line.length) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; }
      else if (c === '"') { inQ = false; i++; }
      else { cur += c; i++; }
    } else {
      if (c === '"') { inQ = true; i++; }
      else if (c === ',') { fields.push(cur.trim()); cur = ''; i++; }
      else { cur += c; i++; }
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseLine(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = parseLine(line);
    const obj = {};
    headers.forEach((h, j) => { obj[h] = (vals[j] ?? '').trim(); });
    return obj;
  });
}

function pick(r, ...names) {
  for (const n of names) {
    const v = r[n];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function hoursAgo(ts, now) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d)) return null;
  const h = (now - d) / 3_600_000;
  return h >= 0 ? h : null;
}

// ── Build cache ────────────────────────────────────────────────────
async function buildCache(force = false) {
  if (!force && _cache && Date.now() - _lastFetch < CACHE_TTL) return _cache;

  const now = Date.now();
  const resp = await fetch(METABASE_CSV_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!resp.ok) throw new Error(`Metabase CSV ${resp.status}`);

  const rawRows = parseCSV(await resp.text());

  // Parse Metabase date format: "12 Jun, 2026, 11:53" → Date
  function parseMetaDate(s) {
    if (!s) return null;
    // Already ISO
    if (s.includes('T') || s.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(s);
    // "12 Jun, 2026, 11:53" → "12 Jun 2026 11:53"
    const cleaned = s.replace(/,/g, '').trim();
    const d = new Date(cleaned);
    return isNaN(d) ? null : d;
  }

  // Map to normalised shape
  const rows = rawRows.map(r => {
    const createdRaw = pick(r, 'createdAt', 'created_at', 'created_on', 'vinCreation');
    const createdDate = parseMetaDate(createdRaw);
    const hrsAgo = createdDate ? (now - createdDate.getTime()) / 3_600_000 : null;

    return {
      sku:             pick(r, 'spin_sku_id', 'sku', 'sku_id'),
      spinId:          pick(r, 'ss.spin_id', 'spin_id', 'spinId'),
      vin:             pick(r, 'vinName', 'vin_name', 'vin'),
      eid:             pick(r, 'enterpriseId', 'enterprise_id'),
      entName:         pick(r, 'enterprise_name', 'enterpriseName') || pick(r, 'enterpriseId'),
      teamId:          pick(r, 'teamId', 'team_id'),
      teamName:        pick(r, 'team_name', 'teamName'),
      customerSegment: pick(r, 'customer_segment', 'customerSegment'),
      crmStatus:       pick(r, 'crm_status', 'crmStatus'),
      assignedTeam:    pick(r, 'assigned_user_name', 'assignedTeamName', 'assigned_team'),
      entEmail:        pick(r, 'email_id', 'poc_email', 'email'),
      entStage:        pick(r, 'stage'),
      finalStatus:     pick(r, 'final_status', 'finalStatus', 'status'),
      inputType:       pick(r, 'input_type', 'inputType'),
      platform:        pick(r, 'platform'),
      make:            pick(r, 'make'),
      model:           pick(r, 'model'),
      year:            pick(r, 'year'),
      thumbnail:       pick(r, 'thumbnail_url', 'thumbnail'),
      vdpUrl:          pick(r, 'vdp_url', 'vdpUrl'),
      imgCount:        parseInt(pick(r, 'image_count')) || 0,
      overallScore:    pick(r, 'overall_score', 'overallScore'),
      vinScore:        pick(r, 'vin_score', 'vinScore'),
      createdAt:       createdDate ? createdDate.toISOString() : createdRaw,
      hrsCreated:      hrsAgo,
    };
  });

  // All rows from this query are already QC pending (qc_unassigned)
  // No additional filtering needed

  // De-duplicate by SKU (keep one row per unique SKU)
  const seen = new Set();
  const deduped = rows.filter(r => {
    const key = r.sku || r.vin || JSON.stringify(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  _cache = { rows: deduped, total: deduped.length, lastSynced: new Date(now).toISOString() };
  _lastFetch = now;
  return _cache;
}

// ── Handler ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Serve cached response instantly, revalidate in background every 5 min
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const force = req.query.force === '1';
    if (force) { _cache = null; _lastFetch = 0; }

    const data = await buildCache(force);

    // Debug mode
    if (req.query.debug === '1') {
      const sampleRaw = await (async () => {
        const resp2 = await fetch(METABASE_CSV_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const text = await resp2.text();
        const lines = text.trim().split(/\r?\n/);
        return { headers: parseLine(lines[0]), sampleRow: lines[1] };
      })();
      return res.status(200).json({
        total: data.total,
        exactHeaders: sampleRaw.headers,
        sampleRawRow: sampleRaw.sampleRow,
        sampleMapped: data.rows[0],
        uniqueCrmStatus: [...new Set(data.rows.map(r => r.crmStatus).filter(Boolean))],
        uniqueCustomerSegment: [...new Set(data.rows.map(r => r.customerSegment).filter(Boolean))],
        createdAtSample: data.rows.slice(0,5).map(r => r.createdAt),
      });
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

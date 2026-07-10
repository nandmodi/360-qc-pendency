// api/360-pendency.js
// Returns all rows — filtering by crm_status done in frontend
const METABASE_CSV_URL =
      'https://metabase.spyne.ai/public/question/777eeac8-7d6f-49f9-96d4-499cdea1b891.csv';

let _cache = null;
let _lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000;

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

function parseMetaDate(s) {
      if (!s) return null;
      if (s.includes('T') || s.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(s);
      const cleaned = s.replace(/,/g, '').trim() + ' UTC';
      const d = new Date(cleaned);
      return isNaN(d) ? null : d;
}

async function buildCache(force = false) {
      if (!force && _cache && Date.now() - _lastFetch < CACHE_TTL) return _cache;
      const now = Date.now();
      const resp = await fetch(METABASE_CSV_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!resp.ok) throw new Error('Metabase CSV ' + resp.status);
      const rawRows = parseCSV(await resp.text());
      const rows = rawRows.map(r => {
              const createdRaw = pick(r, 'sku_created_on', 'createdAt', 'created_on');
              const createdDate = parseMetaDate(createdRaw);
              return {
                        sku:             pick(r, 'spin_sku_id', 'sku_id', 'sku'),
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
                        createdAt:       createdDate ? createdDate.toISOString() : createdRaw,
              };
      });
      _cache = { rows, total: rows.length, lastSynced: new Date(now).toISOString() };
      _lastFetch = now;
      return _cache;
}

export default async function handler(req, res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
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

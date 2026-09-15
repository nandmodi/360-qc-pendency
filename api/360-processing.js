export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const METABASE_URL = 'https://metabase.spyne.ai';
  const CARD_ID = 7225;
  const username = process.env.METABASE_EMAIL;
  const password = process.env.METABASE_PASSWORD;

  if (!username || !password) {
    return res.status(500).json({ error: 'Metabase credentials not configured.' });
  }

  try {
    const login = await fetch(`${METABASE_URL}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!login.ok) throw new Error(`Login failed (${login.status})`);
    const { id: sessionId } = await login.json();

    const query = await fetch(`${METABASE_URL}/api/card/${CARD_ID}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Metabase-Session': sessionId },
      body: JSON.stringify({})
    });
    if (!query.ok) throw new Error(`Query failed (${query.status})`);

    const result = await query.json();
    const cols = result?.data?.cols || [];
    const rawRows = result?.data?.rows || [];

    const names = cols.map((c, i) => c?.name || c?.display_name || `col_${i}`);

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

    const rows = rawRows.map(row => {
      const r = {};
      names.forEach((n, i) => { r[n] = row[i]; });
      return r;
    });

    // Exact column names from _debug_columns:
    // "t1.sku_id", "t1.enterprise_id", "enterprise_name", "enterprise_version",
    // "created_on", "updated_on", "source", "status", "first_qc_done", "Age", "input_type"
    const normalizedRows = rows.map(r => ({
      sku:             pick(r, 't1.sku_id', 'sku_id', 'spin_sku_id'),
      vin:             '',  // not available in this question
      eid:             pick(r, 't1.enterprise_id', 'enterprise_id', 'enterpriseId'),
      entName:         pick(r, 'enterprise_name', 'enterpriseName') || pick(r, 't1.enterprise_id'),
      inputType:       pick(r, 'input_type', 'inputType', 'source'),
      crmStatus:       pick(r, 'status', 'crm_status', 'crmStatus'),
      firstQcDone:     pick(r, 'first_qc_done', 'firstQcDone'),
      customerSegment: pick(r, 'customer_segment', 'customerSegment'),
      assignedTeam:    pick(r, 'qc_user', 'assigned_user_name'),
      ageHrs:          pick(r, 'Age', 'age'),  // pre-computed age from Metabase
      createdAt:       parseDate(pick(r, 'created_on', 'sku_created_on', 'createdAt', 'created_at')),
      skuCreatedOn:    parseDate(pick(r, 'created_on', 'sku_created_on')),
    }));

    return res.status(200).json({
      rows: normalizedRows,
      total: normalizedRows.length,
      lastSynced: new Date().toISOString()
    });
  } catch (err) {
    console.error('Processing API error:', err);
    return res.status(500).json({ error: err?.message });
  }
}

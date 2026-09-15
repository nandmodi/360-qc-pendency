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

    // Get ALL column names to debug
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

    // Return raw column names in first row for debugging + normalized rows
    const normalizedRows = rows.map(r => ({
      sku:             pick(r, 'spin_sku_id', 'sku_id', 'sku', 'SKU', 'id'),
      vin:             pick(r, 'vinName', 'vin_name', 'vin', 'VIN', 'vehicle_id'),
      eid:             pick(r, 'enterpriseId', 'enterprise_id', 'client_id'),
      entName:         pick(r, 'enterprise_name', 'enterpriseName', 'client_name', 'enterprise') || pick(r, 'enterpriseId', 'enterprise_id'),
      inputType:       pick(r, 'input_type', 'inputType', 'type'),
      crmStatus:       pick(r, 'crm_status', 'crmStatus', 'status'),
      customerSegment: pick(r, 'customer_segment', 'customerSegment', 'segment'),
      assignedTeam:    pick(r, 'qc_user', 'assigned_user_name', 'assignedTeam'),
      createdAt:       parseDate(pick(r, 'sku_created_on', 'skuCreatedOn', 'created_at', 'createdAt', 'created_on')),
      skuCreatedOn:    parseDate(pick(r, 'sku_created_on', 'skuCreatedOn')),
    }));

    return res.status(200).json({
      rows: normalizedRows,
      total: normalizedRows.length,
      lastSynced: new Date().toISOString(),
      _debug_columns: names  // <-- shows actual column names from Metabase
    });
  } catch (err) {
    console.error('Processing API error:', err);
    return res.status(500).json({ error: err?.message });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const METABASE_URL = 'https://metabase.spyne.ai';
  const CARD_ID = 7225;
  const username = process.env.METABASE_EMAIL;
  const password = process.env.METABASE_PASSWORD;

  if (!username || !password) {
    return res.status(500).json({
      error: 'Metabase credentials are not configured. Set METABASE_EMAIL and METABASE_PASSWORD.'
    });
  }

  try {
    const login = await fetch(`${METABASE_URL}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!login.ok) {
      const text = await login.text();
      throw new Error(`Metabase login failed (${login.status}): ${text.slice(0, 300)}`);
    }

    const { id: sessionId } = await login.json();
    if (!sessionId) throw new Error('Metabase did not return a session id');

    const query = await fetch(`${METABASE_URL}/api/card/${CARD_ID}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Metabase-Session': sessionId
      },
      body: JSON.stringify({})
    });

    if (!query.ok) {
      const text = await query.text();
      throw new Error(`Metabase question failed (${query.status}): ${text.slice(0, 500)}`);
    }

    const result = await query.json();
    const data = result?.data;
    const columns = data?.cols || [];
    const rawRows = data?.rows || [];

    const names = columns.map((c, i) =>
      c?.name || c?.display_name || c?.field_ref?.[1] || `column_${i}`
    );

    const rows = rawRows.map(row => {
      const obj = {};
      names.forEach((name, i) => { obj[name] = row[i]; });
      return obj;
    });

    const pick = (row, ...keys) => {
      for (const key of keys) {
        const value = row?.[key];
        if (value !== null && value !== undefined && String(value).trim() !== '') {
          return String(value).trim();
        }
      }
      return '';
    };

    const parseDate = value => {
      if (!value) return '';
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
    };

    const normalizedRows = rows.map(r => ({
      sku:             pick(r, 'spin_sku_id', 'sku', 'sku_id'),
      vin:             pick(r, 'vinName', 'vin_name', 'vin'),
      eid:             pick(r, 'enterpriseId', 'enterprise_id'),
      entName:         pick(r, 'enterprise_name', 'enterpriseName') || pick(r, 'enterpriseId'),
      inputType:       pick(r, 'input_type', 'inputType'),
      crmStatus:       pick(r, 'crm_status', 'crmStatus'),
      customerSegment: pick(r, 'customer_segment', 'customerSegment'),
      assignedTeam:    pick(r, 'qc_user', 'assigned_user_name'),
      // Age calculated from sku_created_on
      createdAt:       parseDate(pick(r, 'sku_created_on', 'skuCreatedOn', 'createdAt', 'created_at')),
      skuCreatedOn:    parseDate(pick(r, 'sku_created_on', 'skuCreatedOn')),
    }));

    return res.status(200).json({
      rows: normalizedRows,
      total: normalizedRows.length,
      lastSynced: new Date().toISOString()
    });
  } catch (err) {
    console.error('360 processing API error:', err);
    return res.status(500).json({
      error: err?.message || 'Failed to fetch Metabase data'
    });
  }
}

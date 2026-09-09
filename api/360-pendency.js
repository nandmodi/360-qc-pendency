export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const METABASE_URL = 'https://metabase.spyne.ai';
  const CARD_ID = 12588;
  const username = process.env.METABASE_EMAIL;
  const password = process.env.METABASE_PASSWORD;

  if (!username || !password) {
    return res.status(500).json({
      error: 'Metabase credentials are not configured. Set METABASE_EMAIL and METABASE_PASSWORD.'
    });
  }

  try {
    // Login server-side. Credentials never reach the browser.
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

    // Execute saved Question 12588.
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

    // Convert Metabase's list-of-lists response into objects.
    const names = columns.map((c, i) =>
      c?.name || c?.display_name || c?.field_ref?.[1] || `column_${i}`
    );

    const rows = rawRows.map(row => {
      const obj = {};
      names.forEach((name, i) => { obj[name] = row[i]; });
      return obj;
    });

    // Build a case-insensitive lookup so sku_created_on is picked reliably
    // regardless of Metabase's returned column casing/display name.
    const keyMap = row => {
      const out = {};
      for (const [k, v] of Object.entries(row || {})) {
        out[String(k).trim().toLowerCase()] = v;
      }
      return out;
    };

    // Normalize Metabase column names to the exact data contract used by the existing UI.
    // This keeps the dashboard UI and all its calculations unchanged.
    const pick = (row, ...keys) => {
      const lookup = keyMap(row);
      for (const key of keys) {
        const value = lookup[String(key).trim().toLowerCase()];
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
      sku: pick(r, 'spin_sku_id', 'sku', 'sku_id', 'SKU ID'),
      spinId: pick(r, 'spin_id', 'spinId', 'ss.spin_id'),
      vin: pick(r, 'vinName', 'vin_name', 'vin', 'VIN'),
      eid: pick(r, 'enterpriseId', 'enterprise_id', 'Ent ID', 'enterprise_id'),
      entName: pick(r, 'enterprise_name', 'enterpriseName', 'Enterprise', 'enterprise') || pick(r, 'enterpriseId', 'enterprise_id'),
      teamId: pick(r, 'teamId', 'team_id', 'Team ID'),
      teamName: pick(r, 'team_name', 'teamName', 'Team'),
      customerSegment: pick(r, 'customer_segment', 'customerSegment', 'Segment'),
      crmStatus: pick(r, 'crm_status', 'crmStatus', 'CRM Status'),
      assignedTeam: pick(r, 'qc_user', 'assigned_user_name', 'assignedTeamName', 'QC User', 'qc_user_name'),
      entEmail: pick(r, 'CS') || pick(r, 'OB'),
      entStage: pick(r, 'stage', 'Stage'),
      finalStatus: pick(r, 'final_status', 'finalStatus', 'status', 'Status'),
      inputType: pick(r, 'input_type', 'inputType', 'Input Type'),
      platform: pick(r, 'platform', 'Platform'),
      make: pick(r, 'make', 'Make'),
      model: pick(r, 'model', 'Model'),
      year: pick(r, 'year', 'Year'),
      thumbnail: pick(r, 'thumbnail_url', 'thumbnail', 'Thumbnail'),
      vdpUrl: pick(r, 'vdp_url', 'vdpUrl', 'VDP URL'),
      imgCount: Number(pick(r, 'image_count', 'imgCount', 'Image Count')) || 0,
      overallScore: pick(r, 'overall_score', 'overallScore'),
      vinScore: pick(r, 'vin_score', 'vinScore'),
      createdAt: parseDate(pick(r, 'createdAt', 'created_at', 'created_on', 'vinCreation', 'Created At')),
      skuCreatedOn: parseDate(pick(r, 'sku_created_on', 'skuCreatedOn', 'SKU Created On')),
      firstQcDone: pick(r, 'first_qc_done', 'firstQcDone', 'First QC Done')
    }));

    // Preserve the frontend contract: { rows, lastSynced }.
    return res.status(200).json({
      rows: normalizedRows,
      lastSynced: new Date().toISOString()
    });
  } catch (err) {
    console.error('360 pendency API error:', err);
    return res.status(500).json({
      error: err?.message || 'Failed to fetch Metabase data'
    });
  }
}

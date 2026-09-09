const METABASE_URL = 'https://metabase.spyne.ai';
const CARD_ID = 12588;

function getValue(row, aliases) {
  for (const key of aliases) {
    if (
      Object.prototype.hasOwnProperty.call(row, key) &&
      row[key] !== null &&
      row[key] !== undefined
    ) {
      return row[key];
    }
  }
  return '';
}

function parseDate(value) {
  if (!value) return '';

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function normalizeRow(row) {
  return {
    sku: getValue(row, [
      'spin_sku_id',
      'sku',
      'sku_id',
      'SKU ID'
    ]),

    spinId: getValue(row, [
      'ss.spin_id',
      'spin_id',
      'spinId'
    ]),

    vin: getValue(row, [
      'vinName',
      'vin_name',
      'vin',
      'VIN'
    ]),

    eid: getValue(row, [
      'enterpriseId',
      'enterprise_id',
      'Ent ID'
    ]),

    entName: getValue(row, [
      'enterprise_name',
      'enterpriseName',
      'Enterprise',
      'enterprise'
    ]),

    teamId: getValue(row, [
      'teamId',
      'team_id',
      'Team ID'
    ]),

    teamName: getValue(row, [
      'team_name',
      'teamName',
      'Team'
    ]),

    customerSegment: String(
      getValue(row, [
        'customer_segment',
        'customerSegment',
        'Segment'
      ]) || ''
    ).trim(),

    crmStatus: String(
      getValue(row, [
        'crm_status',
        'crmStatus',
        'CRM Status'
      ]) || ''
    ).trim(),

    assignedTeam: getValue(row, [
      'qc_user',
      'assigned_user_name',
      'assignedTeamName',
      'QC User',
      'qc_user_name'
    ]),

    entEmail: getValue(row, [
      'CS',
      'OB'
    ]),

    entStage: getValue(row, [
      'stage',
      'Stage'
    ]),

    finalStatus: getValue(row, [
      'final_status',
      'finalStatus',
      'status',
      'Status'
    ]),

    inputType: getValue(row, [
      'input_type',
      'inputType',
      'Input Type'
    ]),

    platform: getValue(row, [
      'platform',
      'Platform'
    ]),

    make: getValue(row, [
      'make',
      'Make'
    ]),

    model: getValue(row, [
      'model',
      'Model'
    ]),

    year: getValue(row, [
      'year',
      'Year'
    ]),

    thumbnail: getValue(row, [
      'thumbnail_url',
      'thumbnail',
      'Thumbnail'
    ]),

    vdpUrl: getValue(row, [
      'vdp_url',
      'vdpUrl',
      'VDP URL'
    ]),

    imgCount: getValue(row, [
      'image_count',
      'imgCount',
      'Image Count'
    ]) || 0,

    overallScore: getValue(row, [
      'overall_score',
      'overallScore'
    ]),

    vinScore: getValue(row, [
      'vin_score',
      'vinScore'
    ]),

    createdAt: parseDate(
      getValue(row, [
        'createdAt',
        'created_at',
        'created_on',
        'vinCreation',
        'Created At'
      ])
    ),

    firstQcDone: getValue(row, [
      'first_qc_done',
      'firstQcDone',
      'First QC Done'
    ])
  };
}

async function metabaseLogin() {
  const email = process.env.METABASE_EMAIL;
  const password = process.env.METABASE_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'METABASE_EMAIL or METABASE_PASSWORD is not configured'
    );
  }

  const response = await fetch(`${METABASE_URL}/api/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: email,
      password: password
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Metabase login failed: HTTP ${response.status} ${text}`
    );
  }

  const data = await response.json();

  if (!data.id) {
    throw new Error('Metabase login succeeded but no session ID was returned');
  }

  return data.id;
}

async function runQuestion(sessionId) {
  const response = await fetch(
    `${METABASE_URL}/api/card/${CARD_ID}/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Metabase-Session': sessionId
      },
      body: JSON.stringify({})
    }
  );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Metabase question failed: HTTP ${response.status} ${text}`
    );
  }

  return response.json();
}

function convertMetabaseResult(data) {
  const columns = data?.data?.cols || [];
  const rows = data?.data?.rows || [];

  const columnNames = columns.map((column, index) => {
    return (
      column.name ||
      column.display_name ||
      column.field_ref ||
      `column_${index}`
    );
  });

  return rows.map(row => {
    const obj = {};

    columnNames.forEach((name, index) => {
      obj[name] = row[index];
    });

    return obj;
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {
    const sessionId = await metabaseLogin();

    const result = await runQuestion(sessionId);

    const rawRows = convertMetabaseResult(result);

    const rows = rawRows.map(normalizeRow);

    if (!rows.length) {
      return res.status(200).json({
        rows: [],
        lastSynced: new Date().toISOString()
      });
    }

    return res.status(200).json({
      rows,
      lastSynced: new Date().toISOString()
    });

  } catch (error) {
    console.error('360 Pendency API error:', error);

    return res.status(500).json({
      error: error?.message || 'Failed to load Metabase data'
    });
  }
}

const {getPool,ensureSchema} = require('./_common');

const ALLOWED_EVENTS = new Set([
  'Cookie Consent',
  'Search Tab Opened',
  'Deal Route Selected',
  'Explore Destination Selected',
  'Price Alert Requested',
  'Car Partner Click'
]);

function cleanString(value, max=80){
  return String(value == null ? '' : value).trim().slice(0,max);
}

function cleanData(input){
  const out={};
  if(!input || typeof input!=='object' || Array.isArray(input)) return out;

  const allowedKeys=new Set([
    'tab','source','code','category','currency','confirmation','partner','choice'
  ]);

  for(const [key,value] of Object.entries(input)){
    if(!allowedKeys.has(key)) continue;
    if(typeof value==='string' || typeof value==='number' || typeof value==='boolean'){
      out[key]=cleanString(value,80);
    }
  }
  return out;
}

async function ensureAnalyticsSchema(db){
  await db.query(`
    CREATE TABLE IF NOT EXISTS conversion_events (
      id BIGSERIAL PRIMARY KEY,
      event_name TEXT NOT NULL,
      event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      page_path TEXT NOT NULL DEFAULT '/',
      language TEXT NOT NULL DEFAULT 'nl',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS conversion_events_created_at_idx
    ON conversion_events(created_at DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS conversion_events_name_idx
    ON conversion_events(event_name)
  `);
}

module.exports = async function handler(req,res){
  try{
    if(req.method!=='POST'){
      res.setHeader('Allow','POST');
      return res.status(405).json({error:'method_not_allowed'});
    }

    const body=req.body||{};
    const event=cleanString(body.event,60);

    if(!ALLOWED_EVENTS.has(event)){
      return res.status(400).json({error:'invalid_event'});
    }

    const path=cleanString(body.path||'/',160) || '/';
    const lang=/^(nl|en|de|fr|es)$/.test(cleanString(body.lang,5))
      ? cleanString(body.lang,5)
      : 'nl';
    const data=cleanData(body.data);

    await ensureSchema();
    const db=getPool();
    await ensureAnalyticsSchema(db);

    await db.query(
      `INSERT INTO conversion_events(event_name,event_data,page_path,language)
       VALUES($1,$2::jsonb,$3,$4)`,
      [event,JSON.stringify(data),path,lang]
    );

    res.setHeader('Cache-Control','no-store');
    return res.status(201).json({ok:true});
  }catch(err){
    console.error('track-event failed',err);
    return res.status(500).json({error:'server_error'});
  }
};

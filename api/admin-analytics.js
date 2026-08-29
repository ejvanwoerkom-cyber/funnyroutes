const {getPool,ensureSchema} = require('./_common');

function unauthorized(res){
  res.setHeader('WWW-Authenticate','Bearer');
  return res.status(401).json({error:'unauthorized'});
}

module.exports = async function handler(req,res){
  try{
    if(req.method!=='GET'){
      res.setHeader('Allow','GET');
      return res.status(405).json({error:'method_not_allowed'});
    }

    const expected=process.env.ANALYTICS_ADMIN_KEY;
    if(!expected){
      console.error('ANALYTICS_ADMIN_KEY is missing');
      return res.status(503).json({error:'admin_key_not_configured'});
    }

    const auth=String(req.headers.authorization||'');
    const supplied=auth.startsWith('Bearer ')?auth.slice(7):'';
    if(!supplied || supplied!==expected)return unauthorized(res);

    let days=parseInt(req.query.days||'30',10);
    if(![7,30,90].includes(days))days=30;

    await ensureSchema();
    const db=getPool();

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

    const interval=`${days} days`;

    const [byEventR,byLangR,bySearchTypeR,byDestinationR,byDealR,byDayR]=await Promise.all([
      db.query(`
        SELECT event_name AS key, COUNT(*)::int AS count
        FROM conversion_events
        WHERE created_at >= NOW() - $1::interval
        GROUP BY event_name
        ORDER BY count DESC,event_name
      `,[interval]),
      db.query(`
        SELECT language AS key, COUNT(*)::int AS count
        FROM conversion_events
        WHERE created_at >= NOW() - $1::interval
        GROUP BY language
        ORDER BY count DESC,language
      `,[interval]),
      db.query(`
        SELECT COALESCE(NULLIF(event_data->>'tab',''),'unknown') AS key,
               COUNT(*)::int AS count
        FROM conversion_events
        WHERE created_at >= NOW() - $1::interval
          AND event_name='Search Tab Opened'
        GROUP BY 1
        ORDER BY count DESC,key
      `,[interval]),
      db.query(`
        SELECT event_data->>'code' AS key,
               COUNT(*)::int AS count
        FROM conversion_events
        WHERE created_at >= NOW() - $1::interval
          AND event_name IN ('Deal Route Selected','Explore Destination Selected')
          AND COALESCE(event_data->>'code','') <> ''
        GROUP BY 1
        ORDER BY count DESC,key
        LIMIT 20
      `,[interval]),
      db.query(`
        SELECT event_data->>'code' AS key,
               COUNT(*)::int AS count
        FROM conversion_events
        WHERE created_at >= NOW() - $1::interval
          AND event_name='Deal Route Selected'
          AND COALESCE(event_data->>'code','') <> ''
        GROUP BY 1
        ORDER BY count DESC,key
        LIMIT 20
      `,[interval]),
      db.query(`
        SELECT TO_CHAR(created_at AT TIME ZONE 'Europe/Amsterdam','YYYY-MM-DD') AS key,
               COUNT(*)::int AS count
        FROM conversion_events
        WHERE created_at >= NOW() - $1::interval
        GROUP BY 1
        ORDER BY 1 DESC
      `,[interval])
    ]);

    const byEvent=byEventR.rows;
    const countFor=(name)=>byEvent.find(x=>x.key===name)?.count||0;
    const total=byEvent.reduce((s,x)=>s+x.count,0);

    const summary={
      total,
      priceAlerts:countFor('Price Alert Requested'),
      carClicks:countFor('Car Partner Click'),
      dealClicks:countFor('Deal Route Selected')+countFor('Explore Destination Selected')
    };

    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({
      days,
      summary,
      byEvent,
      byLanguage:byLangR.rows,
      bySearchType:bySearchTypeR.rows,
      byDestination:byDestinationR.rows,
      byDeal:byDealR.rows,
      byDay:byDayR.rows
    });
  }catch(err){
    console.error('admin-analytics failed',err);
    return res.status(500).json({error:'server_error'});
  }
};

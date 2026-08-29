const {getPool,ensureSchema} = require('./_common');

function page(title,message,ok=true){
  const color = ok ? '#1597e5' : '#c2410c';
  return `<!doctype html>
  <html lang="nl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} | FunnyRoutes.com</title>
  </head>
  <body style="margin:0;background:#f4fbff;font-family:Arial,sans-serif;color:#0f2f4f">
    <div style="max-width:620px;margin:70px auto;padding:0 20px">
      <div style="background:white;border:1px solid #d9ebf7;border-radius:20px;padding:34px;box-shadow:0 10px 30px rgba(15,47,79,.08)">
        <div style="font-size:28px;font-weight:800;color:#1597e5;margin-bottom:20px">Funny<span style="color:#ff7200">Routes</span>.com</div>
        <h1 style="font-size:30px;color:${color};margin:0 0 14px">${title}</h1>
        <p style="font-size:17px;line-height:1.6">${message}</p>
        <p style="margin-top:28px">
          <a href="https://funnyroutes.com/" style="display:inline-block;background:#ff7200;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Terug naar FunnyRoutes</a>
        </p>
      </div>
    </div>
  </body>
  </html>`;
}

module.exports = async function handler(req,res){
  try{
    if(req.method!=='GET'){
      res.setHeader('Allow','GET');
      return res.status(405).send('Method not allowed');
    }

    await ensureSchema();
    const db=getPool();

    await db.query(`
      ALTER TABLE price_alerts
      ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ
    `);

    const id=String(req.query?.id||'');
    const token=String(req.query?.token||'');

    if(!id||!token){
      return res.status(400).send(page(
        'Ongeldige bevestigingslink',
        'Deze bevestigingslink is niet compleet. Vraag indien nodig opnieuw een prijsalert aan.',
        false
      ));
    }

    const found=await db.query(`
      SELECT id, active, confirmed_at, lang, analytics_visitor_id
      FROM price_alerts
      WHERE id=$1 AND manage_token=$2
      LIMIT 1
    `,[id,token]);

    if(!found.rowCount){
      return res.status(404).send(page(
        'Bevestigingslink niet gevonden',
        'Deze link is ongeldig of hoort niet meer bij een bestaande prijsalert.',
        false
      ));
    }

    const row=found.rows[0];

    if(row.active===true && row.confirmed_at){
      return res.status(200).send(page(
        'Prijsalert is al actief',
        'Je had deze prijsalert al bevestigd. Je hoeft niets meer te doen.'
      ));
    }

    await db.query(`
      UPDATE price_alerts
      SET active=TRUE,
          confirmed_at=COALESCE(confirmed_at,NOW())
      WHERE id=$1 AND manage_token=$2
    `,[id,token]);

    await db.query(`
      CREATE TABLE IF NOT EXISTS conversion_events (
        id BIGSERIAL PRIMARY KEY,
        event_name TEXT NOT NULL,
        event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        page_path TEXT NOT NULL DEFAULT '/',
        language TEXT NOT NULL DEFAULT 'nl',
        visitor_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.query(`
      ALTER TABLE conversion_events
      ADD COLUMN IF NOT EXISTS visitor_id TEXT
    `);

    await db.query(`
      INSERT INTO conversion_events(event_name,event_data,page_path,language,visitor_id)
      VALUES('Price Alert Confirmed','{}'::jsonb,'/api/confirm-alert',$1,$2)
    `,[row.lang||'nl',row.analytics_visitor_id||null]);

    return res.status(200).send(page(
      'Prijsalert bevestigd',
      'Gelukt! Je FunnyRoutes-prijsalert is nu actief en wordt automatisch gecontroleerd.'
    ));

  }catch(err){
    console.error(err);
    return res.status(500).send(page(
      'Er ging iets mis',
      'De prijsalert kon op dit moment niet worden bevestigd. Probeer het later opnieuw.',
      false
    ));
  }
};

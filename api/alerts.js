const {getPool,ensureSchema,validEmail,safeCurrency,safeLang,resolvePlace,sendEmail,crypto} = require('./_common');

function clientIp(req){
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers?.['x-real-ip'] || '').trim() || '';
}

function hashedKey(prefix,value){
  return `${prefix}:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

function escapeHtml(value){
  return String(value || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

async function ensureExtraSchema(db){
  await db.query(`
    CREATE TABLE IF NOT EXISTS price_alert_rate_limits (
      key_hash TEXT PRIMARY KEY,
      request_count INTEGER NOT NULL DEFAULT 0,
      window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE price_alerts
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ
  `);

  // Bestaande actieve alerts blijven actief en worden beschouwd als reeds bevestigd.
  await db.query(`
    UPDATE price_alerts
    SET confirmed_at = COALESCE(confirmed_at, NOW())
    WHERE active = TRUE AND confirmed_at IS NULL
  `);
}

async function consumeRateLimit(db,keyHash,limit){
  const q = await db.query(`
    INSERT INTO price_alert_rate_limits(key_hash,request_count,window_start)
    VALUES($1,1,NOW())
    ON CONFLICT (key_hash)
    DO UPDATE SET
      request_count = CASE
        WHEN price_alert_rate_limits.window_start <= NOW() - INTERVAL '1 hour' THEN 1
        ELSE price_alert_rate_limits.request_count + 1
      END,
      window_start = CASE
        WHEN price_alert_rate_limits.window_start <= NOW() - INTERVAL '1 hour' THEN NOW()
        ELSE price_alert_rate_limits.window_start
      END
    RETURNING request_count
  `,[keyHash]);

  return Number(q.rows[0]?.request_count || 0) <= limit;
}

function activationEmail({lang,destination,maxPrice,currency,id,token}){
  const baseUrl = process.env.APP_BASE_URL || 'https://funnyroutes.com';
  const activationUrl = `${baseUrl}/api/confirm-alert?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
  const safeDestination = escapeHtml(destination);
  const safePrice = escapeHtml(`${currency.toUpperCase()} ${maxPrice}`);

  const copy = {
    nl: {
      subject: `Bevestig je FunnyRoutes prijsalert voor ${destination}`,
      title: 'Bevestig je prijsalert',
      intro: `Je hebt een prijsalert aangevraagd voor ${safeDestination} met een maximumprijs van ${safePrice}.`,
      button: 'Prijsalert bevestigen',
      note: 'De prijsalert wordt pas actief nadat je op de knop hierboven hebt geklikt.',
      ignore: 'Heb jij deze alert niet aangevraagd? Dan kun je deze e-mail negeren.'
    },
    en: {
      subject: `Confirm your FunnyRoutes price alert for ${destination}`,
      title: 'Confirm your price alert',
      intro: `You requested a price alert for ${safeDestination} with a maximum price of ${safePrice}.`,
      button: 'Confirm price alert',
      note: 'The alert only becomes active after you click the button above.',
      ignore: 'Didn’t request this alert? You can ignore this email.'
    },
    de: {
      subject: `Bestätige deinen FunnyRoutes-Preisalarm für ${destination}`,
      title: 'Preisalarm bestätigen',
      intro: `Du hast einen Preisalarm für ${safeDestination} mit einem Höchstpreis von ${safePrice} angefordert.`,
      button: 'Preisalarm bestätigen',
      note: 'Der Preisalarm wird erst aktiv, nachdem du auf die Schaltfläche geklickt hast.',
      ignore: 'Du hast diesen Alarm nicht angefordert? Dann kannst du diese E-Mail ignorieren.'
    },
    fr: {
      subject: `Confirmez votre alerte de prix FunnyRoutes pour ${destination}`,
      title: 'Confirmez votre alerte de prix',
      intro: `Vous avez demandé une alerte pour ${safeDestination} avec un prix maximum de ${safePrice}.`,
      button: 'Confirmer l’alerte',
      note: 'L’alerte ne devient active qu’après avoir cliqué sur le bouton ci-dessus.',
      ignore: 'Vous n’avez pas demandé cette alerte ? Vous pouvez ignorer cet e-mail.'
    },
    es: {
      subject: `Confirma tu alerta de precio FunnyRoutes para ${destination}`,
      title: 'Confirma tu alerta de precio',
      intro: `Has solicitado una alerta para ${safeDestination} con un precio máximo de ${safePrice}.`,
      button: 'Confirmar alerta',
      note: 'La alerta solo se activa después de hacer clic en el botón.',
      ignore: '¿No solicitaste esta alerta? Puedes ignorar este correo.'
    }
  }[lang] || null;

  const t = copy || {
    subject: `Bevestig je FunnyRoutes prijsalert voor ${destination}`,
    title: 'Bevestig je prijsalert',
    intro: `Je hebt een prijsalert aangevraagd voor ${safeDestination} met een maximumprijs van ${safePrice}.`,
    button: 'Prijsalert bevestigen',
    note: 'De prijsalert wordt pas actief nadat je op de knop hierboven hebt geklikt.',
    ignore: 'Heb jij deze alert niet aangevraagd? Dan kun je deze e-mail negeren.'
  };

  return {
    subject: t.subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#0f2f4f;line-height:1.6">
        <h2 style="color:#1597e5">${t.title}</h2>
        <p>${t.intro}</p>
        <p style="margin:26px 0">
          <a href="${activationUrl}" style="display:inline-block;background:#ff7200;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">
            ${t.button}
          </a>
        </p>
        <p><strong>${t.note}</strong></p>
        <p style="font-size:13px;color:#66788a">${t.ignore}</p>
        <p style="font-size:12px;color:#8090a0">FunnyRoutes.com — Litoro Investments B.V.</p>
      </div>
    `
  };
}

module.exports = async function handler(req,res){
  try{
    await ensureSchema();
    const db=getPool();

    if(req.method==='POST'){
      const b=req.body||{};
      const email=String(b.email||'').trim().toLowerCase();
      const destination=String(b.destination||'').trim();
      const maxPrice=Number(b.maxPrice);
      const currency=safeCurrency(b.currency);
      const lang=safeLang(b.lang);
      const originCode=/^[A-Za-z]{3}$/.test(String(b.originCode||''))?String(b.originCode).toUpperCase():'AMS';

      if(!destination||!validEmail(email)||!Number.isFinite(maxPrice)||maxPrice<=0){
        return res.status(400).json({error:'invalid_input'});
      }

      await ensureExtraSchema(db);

      const ip=clientIp(req);
      if(ip){
        const ipAllowed=await consumeRateLimit(db,hashedKey('ip',ip),5);
        if(!ipAllowed){
          res.setHeader('Retry-After','3600');
          return res.status(429).json({error:'rate_limited_ip'});
        }
      }

      const emailAllowed=await consumeRateLimit(db,hashedKey('email',email),3);
      if(!emailAllowed){
        res.setHeader('Retry-After','3600');
        return res.status(429).json({error:'rate_limited_email'});
      }

      let place;
      if(/^[A-Za-z]{3}$/.test(String(b.destinationCode||''))){
        place={code:String(b.destinationCode).toUpperCase(),name:destination};
      }else{
        place=await resolvePlace(destination,lang);
      }

      const existing=await db.query(`
        SELECT id, manage_token, active, confirmed_at
        FROM price_alerts
        WHERE email=$1
          AND origin_code=$2
          AND destination_code=$3
          AND currency=$4
          AND max_price=$5
        ORDER BY id DESC
        LIMIT 1
      `,[email,originCode,place.code,currency,maxPrice]);

      if(existing.rowCount){
        const row=existing.rows[0];

        if(row.active===true || row.confirmed_at){
          return res.status(409).json({error:'duplicate'});
        }

        // Nog niet bevestigde aanvraag: stuur de bevestigingsmail opnieuw.
        const copy=activationEmail({
          lang,
          destination:place.name,
          maxPrice,
          currency,
          id:String(row.id),
          token:row.manage_token
        });

        try{
          await sendEmail({to:email,subject:copy.subject,html:copy.html});
        }catch(mailErr){
          console.error('activation email failed',mailErr);
          return res.status(502).json({error:'email_failed'});
        }

        return res.status(200).json({
          ok:true,
          pendingConfirmation:true,
          id:String(row.id),
          manageToken:row.manage_token,
          destinationName:place.name,
          destinationCode:place.code,
          originCode
        });
      }

      const token=crypto.randomBytes(24).toString('hex');

      const q=await db.query(`
        INSERT INTO price_alerts(
          email,origin_code,destination_name,destination_code,
          max_price,currency,lang,manage_token,active,confirmed_at
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,FALSE,NULL)
        RETURNING id
      `,[email,originCode,place.name,place.code,maxPrice,currency,lang,token]);

      const id=String(q.rows[0].id);
      const copy=activationEmail({
        lang,
        destination:place.name,
        maxPrice,
        currency,
        id,
        token
      });

      try{
        await sendEmail({to:email,subject:copy.subject,html:copy.html});
      }catch(mailErr){
        console.error('activation email failed',mailErr);
        await db.query(`DELETE FROM price_alerts WHERE id=$1 AND active=FALSE AND confirmed_at IS NULL`,[id]).catch(()=>{});
        return res.status(502).json({error:'email_failed'});
      }

      return res.status(201).json({
        ok:true,
        pendingConfirmation:true,
        id,
        manageToken:token,
        destinationName:place.name,
        destinationCode:place.code,
        originCode
      });
    }

    if(req.method==='DELETE'){
      const id=String(req.query?.id||'');
      const token=String(req.query?.token||'');

      if(!id||!token){
        return res.status(400).json({error:'missing'});
      }

      const q=await db.query(`
        UPDATE price_alerts
        SET active=FALSE
        WHERE id=$1
          AND manage_token=$2
          AND active=TRUE
        RETURNING id
      `,[id,token]);

      return res.status(q.rowCount?200:404).json({ok:!!q.rowCount});
    }

    res.setHeader('Allow','POST, DELETE');
    return res.status(405).json({error:'method_not_allowed'});

  }catch(err){
    console.error(err);
    return res.status(500).json({error:'server_error'});
  }
};

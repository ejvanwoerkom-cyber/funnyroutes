const {getPool,ensureSchema,validEmail,safeCurrency,safeLang,resolvePlace,sendEmail,confirmationCopy,crypto} = require('./_common');

function clientIp(req){
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers?.['x-real-ip'] || '').trim() || '';
}

function hashedKey(prefix,value){
  return `${prefix}:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

async function ensureRateLimitSchema(db){
  await db.query(`
    CREATE TABLE IF NOT EXISTS price_alert_rate_limits (
      key_hash TEXT PRIMARY KEY,
      request_count INTEGER NOT NULL DEFAULT 0,
      window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
    RETURNING request_count, window_start
  `,[keyHash]);

  return Number(q.rows[0]?.request_count || 0) <= limit;
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

      // Rate limiting:
      // - max. 5 nieuwe alert-aanvragen per IP-adres per uur
      // - max. 3 nieuwe alert-aanvragen per e-mailadres per uur
      await ensureRateLimitSchema(db);

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

      const dup=await db.query(
        `SELECT id FROM price_alerts
         WHERE active=TRUE
           AND email=$1
           AND origin_code=$2
           AND destination_code=$3
           AND currency=$4
           AND max_price=$5
         LIMIT 1`,
        [email,originCode,place.code,currency,maxPrice]
      );

      if(dup.rowCount){
        return res.status(409).json({error:'duplicate'});
      }

      const token=crypto.randomBytes(24).toString('hex');

      const q=await db.query(
        `INSERT INTO price_alerts(
          email,origin_code,destination_name,destination_code,
          max_price,currency,lang,manage_token
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id`,
        [email,originCode,place.name,place.code,maxPrice,currency,lang,token]
      );

      const copy=confirmationCopy(lang,place.name,originCode,maxPrice,currency,token);

      try{
        await sendEmail({to:email,subject:copy.subject,html:copy.html});
      }catch(mailErr){
        console.error('confirmation email failed',mailErr);
      }

      return res.status(201).json({
        ok:true,
        id:String(q.rows[0].id),
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

      const q=await db.query(
        `UPDATE price_alerts
         SET active=FALSE
         WHERE id=$1
           AND manage_token=$2
           AND active=TRUE
         RETURNING id`,
        [id,token]
      );

      return res.status(q.rowCount?200:404).json({ok:!!q.rowCount});
    }

    res.setHeader('Allow','POST, DELETE');
    return res.status(405).json({error:'method_not_allowed'});

  }catch(err){
    console.error(err);
    return res.status(500).json({error:'server_error'});
  }
};

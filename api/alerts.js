const {getPool,ensureSchema,validEmail,safeCurrency,safeLang,resolvePlace,sendEmail,confirmationCopy,crypto} = require('./_common');

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
      if(!destination||!validEmail(email)||!Number.isFinite(maxPrice)||maxPrice<=0) return res.status(400).json({error:'invalid_input'});
      let place;
      if(/^[A-Za-z]{3}$/.test(String(b.destinationCode||''))){place={code:String(b.destinationCode).toUpperCase(),name:destination};}
      else place=await resolvePlace(destination,lang);
      const dup=await db.query(`SELECT id FROM price_alerts WHERE active=TRUE AND email=$1 AND origin_code=$2 AND destination_code=$3 AND currency=$4 AND max_price=$5 LIMIT 1`,[email,originCode,place.code,currency,maxPrice]);
      if(dup.rowCount) return res.status(409).json({error:'duplicate'});
      const token=crypto.randomBytes(24).toString('hex');
      const q=await db.query(`INSERT INTO price_alerts(email,origin_code,destination_name,destination_code,max_price,currency,lang,manage_token) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[email,originCode,place.name,place.code,maxPrice,currency,lang,token]);
      const copy=confirmationCopy(lang,place.name,originCode,maxPrice,currency,token);
      try{ await sendEmail({to:email,subject:copy.subject,html:copy.html}); }catch(mailErr){ console.error('confirmation email failed',mailErr); }
      return res.status(201).json({ok:true,id:String(q.rows[0].id),manageToken:token,destinationName:place.name,destinationCode:place.code,originCode});
    }
    if(req.method==='DELETE'){
      const id=String(req.query?.id||''); const token=String(req.query?.token||'');
      if(!id||!token) return res.status(400).json({error:'missing'});
      const q=await db.query(`UPDATE price_alerts SET active=FALSE WHERE id=$1 AND manage_token=$2 AND active=TRUE RETURNING id`,[id,token]);
      return res.status(q.rowCount?200:404).json({ok:!!q.rowCount});
    }
    res.setHeader('Allow','POST, DELETE'); return res.status(405).json({error:'method_not_allowed'});
  }catch(err){ console.error(err); return res.status(500).json({error:'server_error'}); }
};

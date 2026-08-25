const { Pool } = require('pg');
const crypto = require('crypto');

let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing');const {getPool,ensureSchema,sendEmail,esc} = require('./_common');

function cheapestFromPayload(payload){
  let rows=[];
  if(Array.isArray(payload)) rows=payload;
  else if(Array.isArray(payload?.data)) rows=payload.data;
  else if(payload?.data && typeof payload.data==='object') rows=Object.values(payload.data).flatMap(v=>Array.isArray(v)?v:[v]);
  rows=rows.filter(Boolean);
  let best=null;const {getPool,ensureSchema} = require('./_common');
module.exports=async function handler(req,res){
  try{
    await ensureSchema();
    const token=String(req.query?.token||'');
    if(!token) return res.status(400).send('Ongeldige link.');
    const q=await getPool().query(`UPDATE price_alerts SET active=FALSE WHERE manage_token=$1 AND active=TRUE RETURNING id`,[token]);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html><meta charset="utf-8"><title>FunnyRoutes</title><body style="font-family:Arial,sans-serif;background:#eef8ff;padding:40px"><main style="max-width:580px;margin:auto;background:white;padding:30px;border-radius:20px"><h1 style="color:#1267e9">Funny<span style="color:#ff6a00">Routes</span></h1><h2>${q.rowCount?'Prijsalert gestopt':'Prijsalert was al gestopt'}</h2><p>${q.rowCount?'Je ontvangt voor deze alert geen e-mails meer.':'Er hoefde niets meer te worden aangepast.'}</p><p><a href="https://funnyroutes.com">Terug naar FunnyRoutes</a></p></main></body>`);
  }catch(err){console.error(err);return res.status(500).send('Er ging iets mis.');}
};

  for(const r of rows){
    const value=Number(r.value ?? r.price);
    if(Number.isFinite(value) && value>0 && (!best || value<best.price)) best={price:value,departure:r.departure_at||r.depart_date||'',returnAt:r.return_at||r.return_date||'',link:r.link||r.ticket_link||''};
  }
  return best;
}
function langCopy(lang,a,best){
  const cur=a.currency.toUpperCase();
  const route=`${a.origin_code} → ${a.destination_name}`;
  const copies={
    nl:{subject:`Prijsalarm: ${route} vanaf ${cur} ${Math.round(best.price)}`,title:'Goed nieuws: je prijsgrens is bereikt',body:`We vonden een prijs van ${cur} ${Math.round(best.price)} voor ${route}. Jouw ingestelde maximumprijs is ${cur} ${Math.round(a.max_price)}.`,cta:'Zoek deze vlucht op FunnyRoutes',un:'Prijsalert stoppen'},
    en:{subject:`Price alert: ${route} from ${cur} ${Math.round(best.price)}`,title:'Good news: your target price has been reached',body:`We found a fare of ${cur} ${Math.round(best.price)} for ${route}. Your maximum price is ${cur} ${Math.round(a.max_price)}.`,cta:'Search this flight on FunnyRoutes',un:'Stop this price alert'},
    de:{subject:`Preisalarm: ${route} ab ${cur} ${Math.round(best.price)}`,title:'Gute Nachrichten: Dein Zielpreis wurde erreicht',body:`Wir haben einen Preis von ${cur} ${Math.round(best.price)} für ${route} gefunden. Dein Höchstpreis ist ${cur} ${Math.round(a.max_price)}.`,cta:'Flug auf FunnyRoutes suchen',un:'Preisalarm stoppen'},
    fr:{subject:`Alerte prix : ${route} dès ${cur} ${Math.round(best.price)}`,title:'Bonne nouvelle : votre prix cible est atteint',body:`Nous avons trouvé un tarif de ${cur} ${Math.round(best.price)} pour ${route}. Votre prix maximum est ${cur} ${Math.round(a.max_price)}.`,cta:'Rechercher ce vol sur FunnyRoutes',un:'Arrêter cette alerte'},
    es:{subject:`Alerta de precio: ${route} desde ${cur} ${Math.round(best.price)}`,title:'Buenas noticias: se ha alcanzado tu precio objetivo',body:`Encontramos una tarifa de ${cur} ${Math.round(best.price)} para ${route}. Tu precio máximo es ${cur} ${Math.round(a.max_price)}.`,cta:'Buscar este vuelo en FunnyRoutes',un:'Desactivar esta alerta'}
  };return copies[a.lang]||copies.nl;
}

module.exports=async function handler(req,res){
  try{
    const secret=process.env.CRON_SECRET;
    if(!secret || req.headers.authorization!==`Bearer ${secret}`) return res.status(401).json({error:'unauthorized'});
    if(!process.env.TRAVELPAYOUTS_API_TOKEN) return res.status(500).json({error:'travelpayouts_token_missing'});
    await ensureSchema(); const db=getPool();
    const q=await db.query(`SELECT * FROM price_alerts WHERE active=TRUE ORDER BY created_at ASC LIMIT 250`);
    let checked=0,notified=0,errors=0;
    for(const a of q.rows){
      try{
        const url=new URL('https://api.travelpayouts.com/aviasales/v3/search_by_price_range');
        url.searchParams.set('origin',a.origin_code);url.searchParams.set('destination',a.destination_code);
        url.searchParams.set('value_min','1');url.searchParams.set('value_max',String(Math.ceil(Number(a.max_price))));
        url.searchParams.set('one_way','false');url.searchParams.set('direct','false');url.searchParams.set('locale',a.lang==='nl'?'en':a.lang);
        url.searchParams.set('currency',a.currency);url.searchParams.set('market','nl');url.searchParams.set('limit','10');url.searchParams.set('page','1');
        url.searchParams.set('token',process.env.TRAVELPAYOUTS_API_TOKEN);
        const r=await fetch(url); if(!r.ok){throw new Error(`tp_${r.status}`);} const payload=await r.json(); const best=cheapestFromPayload(payload); checked++;
        if(!best){await db.query(`UPDATE price_alerts SET last_checked_at=NOW() WHERE id=$1`,[a.id]);continue;}
        const max=Number(a.max_price),prevNotify=a.last_notified_price==null?null:Number(a.last_notified_price);
        const shouldNotify=best.price<=max && (prevNotify===null || best.price<=prevNotify*0.95);
        await db.query(`UPDATE price_alerts SET last_checked_at=NOW(),last_seen_price=$2 WHERE id=$1`,[a.id,best.price]);
        if(shouldNotify && notified<80){
          const c=langCopy(a.lang,a,best);const unsubscribe=`https://funnyroutes.com/api/unsubscribe?token=${encodeURIComponent(a.manage_token)}`;
          const html=`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#10243d"><div style="font-size:28px;font-weight:900;color:#1267e9">Funny<span style="color:#ff6a00">Routes</span></div><h2>${esc(c.title)}</h2><p style="font-size:16px;line-height:1.6">${esc(c.body)}</p>${best.departure?`<p><strong>${esc(best.departure)}</strong>${best.returnAt?` – ${esc(best.returnAt)}`:''}</p>`:''}<p><a href="https://funnyroutes.com/#search" style="display:inline-block;background:#ff6a00;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">${esc(c.cta)}</a></p><p style="font-size:12px;color:#68798c;margin-top:28px"><a href="${unsubscribe}" style="color:#68798c">${esc(c.un)}</a></p></div>`;
          await sendEmail({to:a.email,subject:c.subject,html});
          await db.query(`UPDATE price_alerts SET last_notified_price=$2,last_notified_at=NOW() WHERE id=$1`,[a.id,best.price]);notified++;
        }
      }catch(e){errors++;console.error('alert check failed',a.id,e);}
    }
    return res.status(200).json({ok:true,alerts:q.rowCount,checked,notified,errors});
  }catch(err){console.error(err);return res.status(500).json({error:'server_error'});}
};

    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  }
  return pool;
}const {getPool,ensureSchema,validEmail,safeCurrency,safeLang,resolvePlace,sendEmail,confirmationCopy,crypto} = require('./_common');

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


async function ensureSchema() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS price_alerts (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      origin_code VARCHAR(3) NOT NULL DEFAULT 'AMS',
      destination_name TEXT NOT NULL,
      destination_code VARCHAR(3) NOT NULL,
      max_price NUMERIC(12,2) NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'eur',
      lang VARCHAR(5) NOT NULL DEFAULT 'nl',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      manage_token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_checked_at TIMESTAMPTZ,
      last_seen_price NUMERIC(12,2),
      last_notified_price NUMERIC(12,2),
      last_notified_at TIMESTAMPTZ
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(active);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_price_alerts_route ON price_alerts(origin_code,destination_code,currency);`);
}

function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'')); }
function safeCurrency(v){ const c=String(v||'eur').toLowerCase(); return ['eur','usd','gbp','chf','thb','idr'].includes(c)?c:'eur'; }
function safeLang(v){ const l=String(v||'nl').toLowerCase(); return ['nl','en','de','fr','es'].includes(l)?l:'nl'; }

async function resolvePlace(term, locale='nl') {
  const q = String(term||'').trim();
  if (/^[A-Za-z]{3}$/.test(q)) return { code:q.toUpperCase(), name:q.toUpperCase() };
  const url = new URL('https://autocomplete.travelpayouts.com/places2');
  url.searchParams.set('term', q);
  url.searchParams.set('locale', locale);
  url.searchParams.append('types[]','city');
  url.searchParams.append('types[]','airport');
  const r = await fetch(url, { headers: { 'User-Agent':'FunnyRoutes/1.0' } });
  if (!r.ok) throw new Error('place_lookup_failed');
  const data = await r.json();
  const item = Array.isArray(data) ? data.find(x=>x && x.code) : null;
  if (!item) throw new Error('destination_not_found');
  return { code:String(item.city_code || item.code).toUpperCase(), name:item.city_name || item.name || q };
}

function esc(s){ return String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])); }

async function sendEmail({to, subject, html}) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is missing');
  const r = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{'Authorization':`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({from:'FunnyRoutes Price Alerts <alerts@funnyroutes.com>',to:[to],subject,html})
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`resend_${r.status}:${body.slice(0,300)}`);
  }
  return r.json();
}

function confirmationCopy(lang, destination, origin, price, currency, token) {
  const cur = currency.toUpperCase();
  const unsubscribe=`https://funnyroutes.com/api/unsubscribe?token=${encodeURIComponent(token)}`;
  const copies={
    nl:{sub:`Je FunnyRoutes prijsalert is actief: ${destination}`,title:'Je prijsalert is actief',body:`We controleren dagelijks vluchten van ${origin} naar ${destination}. Zodra we een prijs vinden van ${cur} ${price} of lager, sturen we je een e-mail.`,cta:'Bekijk FunnyRoutes',un:'Prijsalert stoppen'},
    en:{sub:`Your FunnyRoutes price alert is active: ${destination}`,title:'Your price alert is active',body:`We check flights from ${origin} to ${destination} every day. When we find a fare of ${cur} ${price} or less, we’ll email you.`,cta:'Open FunnyRoutes',un:'Stop this price alert'},
    de:{sub:`Dein FunnyRoutes Preisalarm ist aktiv: ${destination}`,title:'Dein Preisalarm ist aktiv',body:`Wir prüfen täglich Flüge von ${origin} nach ${destination}. Sobald wir einen Preis von ${cur} ${price} oder weniger finden, senden wir dir eine E-Mail.`,cta:'FunnyRoutes öffnen',un:'Preisalarm stoppen'},
    fr:{sub:`Votre alerte FunnyRoutes est active : ${destination}`,title:'Votre alerte prix est active',body:`Nous vérifions chaque jour les vols de ${origin} vers ${destination}. Dès qu’un tarif de ${cur} ${price} ou moins apparaît, nous vous envoyons un e-mail.`,cta:'Ouvrir FunnyRoutes',un:'Arrêter cette alerte'},
    es:{sub:`Tu alerta de FunnyRoutes está activa: ${destination}`,title:'Tu alerta de precio está activa',body:`Comprobamos a diario vuelos de ${origin} a ${destination}. Cuando encontremos una tarifa de ${cur} ${price} o menos, te enviaremos un correo.`,cta:'Abrir FunnyRoutes',un:'Desactivar esta alerta'}
  };
  const c=copies[lang]||copies.nl;
  const html=`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#10243d"><div style="font-size:28px;font-weight:900;color:#1267e9">Funny<span style="color:#ff6a00">Routes</span></div><h2>${esc(c.title)}</h2><p style="font-size:16px;line-height:1.6">${esc(c.body)}</p><p><a href="https://funnyroutes.com/#search" style="display:inline-block;background:#1267e9;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">${esc(c.cta)}</a></p><p style="font-size:12px;color:#68798c;margin-top:28px"><a href="${unsubscribe}" style="color:#68798c">${esc(c.un)}</a></p></div>`;
  return {subject:c.sub,html};
}

module.exports={getPool,ensureSchema,validEmail,safeCurrency,safeLang,resolvePlace,sendEmail,confirmationCopy,esc,crypto};

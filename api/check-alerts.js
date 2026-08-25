const {getPool,ensureSchema,sendEmail,esc} = require('./_common');

function cheapestFromPayload(payload){
  let rows=[];
  if(Array.isArray(payload)) rows=payload;
  else if(Array.isArray(payload?.data)) rows=payload.data;
  else if(payload?.data && typeof payload.data==='object') rows=Object.values(payload.data).flatMap(v=>Array.isArray(v)?v:[v]);
  rows=rows.filter(Boolean);
  let best=null;
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

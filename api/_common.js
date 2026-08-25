const { Pool } = require('pg');
const crypto = require('crypto');

let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  }
  return pool;
}

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

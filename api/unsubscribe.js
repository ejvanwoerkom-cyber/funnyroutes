const {getPool,ensureSchema} = require('./_common');
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

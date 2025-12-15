import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

/* ======================
   ESM __dirname
====================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ======================
   EXPRESS SETUP
====================== */
const app = express();
app.use(cors());
app.use(express.json());

/* ======================
   MULTI-BOT STORAGE
====================== */
const sessions = new Map(); // username => sock

/* ======================
   CREATE BOT CONNECTION
====================== */
async function createConnection(username, phone) {
  if (sessions.has(username)) return sessions.get(username);

  const sessionDir = path.join(__dirname, 'sessions', username);
  await fs.ensureDir(sessionDir);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['RAIZEL-XMD', 'Chrome', '6.7.5']
  });

  sessions.set(username, sock);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log(`✅ ${username} connecté`);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output.statusCode
        : 0;

      sessions.delete(username);

      if (code !== DisconnectReason.loggedOut) {
        console.log(`🔄 Reconnexion ${username}`);
        setTimeout(() => createConnection(username, phone), 2000);
      }
    }
  });

  return sock;
}

/* ======================
   FRONTEND (index.html)
====================== */
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<title>RAIZEL-XMD • Pairing</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
:root { --bg:#0b0b14; --card:rgba(25,25,40,.75); --primary:#8b5cf6; --primary-glow:#a78bfa; --text:#fff; --muted:#9ca3af; }
* { box-sizing:border-box; font-family:Inter,sans-serif; }
body{margin:0;background:radial-gradient(circle at top,#1a1440,var(--bg));color:var(--text);overflow-x:hidden;}
.bg{position:fixed;inset:0;background:radial-gradient(circle at 20% 20%,#8b5cf630,transparent 40%),radial-gradient(circle at 80% 80%,#6366f130,transparent 40%);animation:bgMove 10s infinite alternate;z-index:0;}
@keyframes bgMove{from{filter:hue-rotate(0deg);}to{filter:hue-rotate(25deg);}}
.app{position:relative;z-index:1;max-width:420px;margin:auto;padding:20px;}
.logo{display:flex;flex-direction:column;align-items:center;margin:30px 0;}
.logo .icon{width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,var(--primary),var(--primary-glow));display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 0 30px var(--primary);}
.logo h1{margin:14px 0 4px;}
.logo p{color:var(--muted);font-size:14px;}
.card{background:var(--card);backdrop-filter:blur(16px);border-radius:18px;padding:18px;margin-bottom:20px;border:1px solid rgba(255,255,255,.08);animation:fadeUp .8s ease;}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}
label{font-size:12px;color:var(--muted);}
input{width:100%;padding:14px;border-radius:12px;border:none;margin-top:6px;margin-bottom:14px;background:#0f0f1e;color:white;}
.btn{width:100%;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,var(--primary),var(--primary-glow));color:white;font-weight:700;cursor:pointer;box-shadow:0 0 20px #8b5cf660;}
.result{text-align:center;margin-top:14px;}
.code{font-size:26px;letter-spacing:6px;color:#22c55e;}
</style>
</head>
<body>
<div class="bg"></div>
<div class="app">
  <div class="logo">
    <div class="icon">Σ</div>
    <h1>RAIZEL-XMD</h1>
    <p>Déploiement de bot WhatsApp</p>
  </div>
  <div class="card">
    <label>Numéro WhatsApp</label>
    <input id="phone" placeholder="2376xxxxxxx" />
    <label>Nom du bot</label>
    <input id="username" placeholder="monbot" />
    <button class="btn" id="generateBtn">GÉNÉRER PAIRING CODE</button>
    <div class="result" id="result"></div>
  </div>
</div>
<script>
const phoneInput=document.getElementById('phone');
const usernameInput=document.getElementById('username');
const result=document.getElementById('result');
document.getElementById('generateBtn').onclick=generate;
async function generate(){
  const phone=phoneInput.value.trim();
  const username=usernameInput.value.trim();
  if(!phone||!username){result.innerHTML='❌ Champs manquants';return;}
  result.innerHTML='⏳ Connexion en cours...';
  try{
    const res=await fetch('/pairing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,username})});
    const data=await res.json();
    if(data.code){result.innerHTML='<div class="code">'+data.code+'</div>';}
    else{result.innerHTML='<pre style="text-align:left; color:#f87171;">'+JSON.stringify(data,null,2)+'</pre>';}
  }catch(e){console.error(e);result.innerHTML='❌ Serveur injoignable';}
}
</script>
</body>
</html>`);
});

/* ======================
   ROUTE PAIRING
====================== */
app.post('/pairing', async (req,res)=>{
  const { username, phone } = req.body;
  if(!username || !phone) return res.json({error:'Champs manquants'});

  try{
    const sock = await createConnection(username, phone);

    if(sock.authState?.creds?.registered)
      return res.json({status:'Déjà connecté'});

    const code = await sock.requestPairingCode(phone);
    return res.json({code});

  }catch(e){
    console.error('Erreur pairing complète:', e);
    return res.json({
      error:'Erreur pairing',
      message:e?.message||'unknown error',
      stack:e?.stack||null,
      data:e?.data||null
    });
  }
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🔥 RAIZEL-XMD backend actif sur ${PORT}`));

process.on('uncaughtException', e => console.error(e));
process.on('unhandledRejection', e => console.error(e));

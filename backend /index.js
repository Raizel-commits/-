import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fs from "fs-extra";
import path from "path";
import pino from "pino";
import qrcode from "qrcode";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";

import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import { fileURLToPath } from 'url';

// ------------------ Setup __dirname pour ES Modules ------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------ Logger ------------------
const logger = pino({ level: process.env.LOG_LEVEL || "info" });

// ------------------ App & Middleware ------------------
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));

// ------------------ Dossiers ------------------
const PORT = process.env.PORT || 3000;
const BASE_DIR = process.env.SESSIONS_DIR || path.resolve('./sessions');
const DATA_DIR = path.resolve('./data');
fs.ensureDirSync(BASE_DIR);
fs.ensureDirSync(DATA_DIR);

// ------------------ Pairings ------------------
const PAIRINGS_FILE = path.join(DATA_DIR, 'pairings.json');
let pairings = {};
if (fs.existsSync(PAIRINGS_FILE)) {
  try { pairings = fs.readJsonSync(PAIRINGS_FILE); } catch(e){ pairings = {}; }
}
function savePairings(){ fs.writeJsonSync(PAIRINGS_FILE, pairings, {spaces:2}); }

// ------------------ Sockets ------------------
const sockets = new Map();

function sessionPathFor(username){
  return path.join(BASE_DIR, username);
}

async function ensureSessionDir(username){
  const dir = sessionPathFor(username);
  await fs.ensureDir(dir);
  return dir;
}

async function startSocketFor(username, webhookUrl = null) {
  if (sockets.has(username)) return sockets.get(username);

  const folder = await ensureSessionDir(username);
  const { state, saveCreds } = await useMultiFileAuthState(folder);
  const { version } = await fetchLatestBaileysVersion().catch(()=>({ version: [2,231,13] }));

  const sock = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: state,
    logger: pino({ level: "silent" })
  });

  sock.ev.on('connection.update', update => {
    logger.info({username, update}, 'connection.update');
  });

  sock.ev.on('messages.upsert', async m => {
    try {
      const messages = m.messages || [];
      for (const msg of messages){
        if (!msg.message || msg.key?.fromMe) continue;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

        if (webhookUrl) {
          fetch(webhookUrl, {
            method: 'POST',
            headers: {'content-type':'application/json'},
            body: JSON.stringify({username, message: msg})
          }).catch(err => logger.warn({err, username}, 'webhook POST failed'));
        }

        if (text && text.startsWith('!')) {
          const parts = text.slice(1).split(/\s+/);
          const cmd = parts[0].toLowerCase();
          const args = parts.slice(1);
          if (cmd === 'ping') {
            await sock.sendMessage(msg.key.remoteJid, { text: 'pong' });
          } else if (cmd === 'echo') {
            await sock.sendMessage(msg.key.remoteJid, { text: args.join(' ') || '...' });
          } else {
            await sock.sendMessage(msg.key.remoteJid, { text: `Commande inconnue: ${cmd}` });
          }
        }
      }
    } catch (e) {
      logger.error({err:e}, 'messages.upsert handler error');
    }
  });

  sock.ev.on('creds.update', saveCreds);
  sockets.set(username, sock);
  return sock;
}

// ------------------ API ------------------

// Générer QR ou pairing code
app.post('/api/pairing', async (req, res) => {
  try {
    const { username, phone, mode = 'pairing', webhookUrl } = req.body;
    if (!username || !phone) return res.status(400).json({ error: 'username & phone required' });

    await ensureSessionDir(username);

    if (mode === 'qr') {
      const folder = sessionPathFor(username);
      const { state, saveCreds } = await useMultiFileAuthState(folder);
      const { version } = await fetchLatestBaileysVersion().catch(()=>({ version: [2,231,13] }));
      const sock = makeWASocket({ version, printQRInTerminal:false, auth: state, logger: pino({ level: "silent" }) });

      if (webhookUrl) {
        sock.ev.on('messages.upsert', async u => {
          try { await fetch(webhookUrl, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({username, u}) }); }
          catch(e){ logger.warn('webhook failed'); }
        });
      }

      const qrPromise = new Promise((resolve, reject) => {
        const tid = setTimeout(()=>{ reject(new Error('QR timeout')); }, 15000);
        const onUpdate = (u) => {
          if (u.qr) {
            clearTimeout(tid); sock.ev.off('connection.update', onUpdate); resolve(u.qr);
          } else if (u.connection && u.connection === 'open') {
            clearTimeout(tid); sock.ev.off('connection.update', onUpdate); resolve(null);
          }
        };
        sock.ev.on('connection.update', onUpdate);
      });

      const qr = await qrPromise;
      if (!qr) return res.json({ status: 'connected' });
      const png = await qrcode.toBuffer(qr, { type: 'png', width: 400 });
      res.set('Content-Type', 'image/png');
      return res.send(png);
    } else {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const expiresAt = Date.now() + (1000 * 60 * 10);
      pairings[code] = { username, phone, createdAt: Date.now(), expiresAt };
      savePairings();
      return res.json({ status: 'ok', pairingCode: code, expiresAt });
    }
  } catch (e) {
    logger.error({err:e}, 'pairing error');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Vérifier code pairing
app.get('/api/pairing/check/:code', (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const p = pairings[code];
  if (!p) return res.json({ valid: false });
  if (p.expiresAt < Date.now()) {
    delete pairings[code];
    savePairings();
    return res.json({ valid: false });
  }
  return res.json({ valid: true, username: p.username, phone: p.phone });
});

// Enregistrer webhook
app.post('/api/webhook/register', async (req, res) => {
  const { username, webhookUrl } = req.body;
  if (!username || !webhookUrl) return res.status(400).json({ error: 'username & webhookUrl required' });
  const metaFile = path.join(sessionPathFor(username), 'meta.json');
  await fs.ensureFile(metaFile);
  const meta = { webhookUrl, updatedAt: Date.now() };
  await fs.writeJson(metaFile, meta, { spaces: 2 });
  await startSocketFor(username, webhookUrl);
  return res.json({ ok: true });
});

// Vérifier session
app.get('/api/session/:username', async (req, res) => {
  const username = req.params.username;
  const folder = sessionPathFor(username);
  const exists = await fs.pathExists(folder);
  let logged = false;
  if (exists) {
    const files = await fs.readdir(folder);
    logged = files.length > 0;
  }
  res.json({ username, exists, logged });
});

// Envoyer message
app.post('/api/send/:username', async (req, res) => {
  const username = req.params.username;
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ error: 'to & text required' });

  try {
    const sock = await startSocketFor(username);
    await sock.sendMessage(to, { text });
    res.json({ ok: true });
  } catch(e) {
    logger.error({err:e}, 'send message error');
    res.status(500).json({ error: 'send_failed' });
  }
});

// Nettoyage pairings expirés
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [k, v] of Object.entries(pairings)) {
    if (v.expiresAt < now) { delete pairings[k]; changed = true; }
  }
  if (changed) savePairings();
}, 60_000);

// ------------------ Frontend ------------------
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  }
});

// ------------------ Start server ------------------
app.listen(PORT, () => {
  logger.info(`RAIZEL XMD Backend listening on ${PORT}`);
});

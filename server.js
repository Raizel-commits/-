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
app.use(express.static(path.join(__dirname, 'public')));

/* ======================
   MULTI-BOT STORAGE
====================== */
const sessions = new Map(); // username => sock
const qrCache = new Map();  // username => qr

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
    const { connection, lastDisconnect, qr } = update;

    if (qr) qrCache.set(username, qr);

    if (connection === 'open') {
      console.log(`✅ ${username} connecté`);
      qrCache.delete(username);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output.statusCode
        : 0;

      sessions.delete(username);
      qrCache.delete(username);

      if (code !== DisconnectReason.loggedOut) {
        console.log(`🔄 Reconnexion ${username}`);
        setTimeout(() => createConnection(username, phone), 2000);
      }
    }
  });

  return sock;
}

/* ======================
   ROUTES
====================== */

/* 🔍 Test */
app.get('/ping', (_, res) => {
  res.json({ ok: true });
});

/* 📸 QR CODE */
app.post('/qr', async (req, res) => {
  const { username, phone } = req.body;
  if (!username || !phone) return res.json({ error: 'Champs manquants' });

  const sock = await createConnection(username, phone);

  let tries = 0;
  const interval = setInterval(() => {
    tries++;
    const qr = qrCache.get(username);
    if (qr) {
      clearInterval(interval);
      return res.json({ qr });
    }
    if (tries > 30) {
      clearInterval(interval);
      return res.json({ status: 'Timeout QR' });
    }
  }, 1000);
});

/* 🔑 PAIRING */
app.post('/pairing', async (req, res) => {
  const { username, phone } = req.body;
  if (!username || !phone) return res.json({ error: 'Champs manquants' });

  const sock = await createConnection(username, phone);

  if (sock.authState?.creds?.registered) return res.json({ status: 'Déjà connecté' });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject('Timeout connexion'), 15000);
      sock.ev.on('connection.update', (update) => {
        if (update.connection === 'open') resolve();
        if (update.connection === 'close') reject('Connexion fermée');
      });
    });

    const code = await sock.requestPairingCode(phone);
    res.json({ code });
  } catch (e) {
    console.error('Erreur pairing:', e);
    res.json({ error: 'Erreur pairing' });
  }
});

/* ======================
   SEND MESSAGE (EXEMPLE)
====================== */
function validNumber(n) {
  const digits = (n || '').replace(/\D/g, '');
  return digits.startsWith('237') && digits.length >= 10 && digits.length <= 15;
}

app.post('/send', async (req, res) => {
  const { username, target, text } = req.body;
  if (!username || !target || !text) return res.status(400).json({ error: 'Champs manquants' });
  if (!validNumber(target)) return res.status(400).json({ error: 'Numéro invalide (doit commencer par 237)' });

  const sock = sessions.get(username);
  if (!sock) return res.status(503).json({ error: 'Bot non connecté' });

  try {
    await sock.sendMessage(`${target.replace(/\D/g, '')}@s.whatsapp.net`, { text });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur envoi message:', err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔥 RAIZEL-XMD backend actif sur ${PORT}`);
});

/* ======================
   SAFE ERRORS
====================== */
process.on('uncaughtException', e => console.error(e));
process.on('unhandledRejection', e => console.error(e));

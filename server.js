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
   EXPRESS
====================== */
const app = express();
app.use(cors());
app.use(express.json());

/* ======================
   STORAGE
====================== */
const sessions = new Map();

/* ======================
   CREATE CONNECTION
====================== */
async function createConnection(username, phone) {
  if (sessions.has(username)) return sessions.get(username);

  const sessionDir = path.join(__dirname, 'sessions', username);
  await fs.ensureDir(sessionDir);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  // Forcer version stable
  const version = [2, 2310, 12];

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['RAIZEL-XMD', 'Chrome', '6.7.5']
  });

  sessions.set(username, sock);
  sock.ev.on('creds.update', saveCreds);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout connection')), 30000);

    sock.ev.on('connection.update', (update) => {
      console.log('🔌 Connection update:', update);

      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        clearTimeout(timeout);
        console.log(`✅ ${username} connecté à WhatsApp`);
        resolve();
      }

      if (connection === 'close') {
        clearTimeout(timeout);
        sessions.delete(username);

        const code = lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : 0;

        if (code !== DisconnectReason.loggedOut) {
          console.log(`🔄 Tentative de reconnexion ${username}`);
          setTimeout(() => createConnection(username, phone), 2000);
        }

        reject(new Error('Connection closed before pairing'));
      }
    });
  });

  return sock;
}

/* ======================
   FRONTEND
====================== */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ======================
   API PAIRING
====================== */
app.post('/api/pairing', async (req, res) => {
  const { username, phone } = req.body;
  if (!username || !phone) return res.status(400).json({ error: 'Champs manquants' });

  try {
    const sock = await createConnection(username, phone);

    if (sock.authState?.creds?.registered)
      return res.json({ status: 'Déjà connecté' });

    const code = await sock.requestPairingCode(phone);
    return res.json({ code });

  } catch (e) {
    console.error('Erreur pairing complète:', e);
    return res.status(500).json({
      error: 'Erreur pairing',
      message: e?.message || 'unknown error',
      stack: e?.stack || null
    });
  }
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 RAIZEL-XMD backend actif sur ${PORT}`));
process.on('uncaughtException', e => console.error(e));
process.on('unhandledRejection', e => console.error(e));

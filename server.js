import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Stockage en mémoire
const sessions = new Map();

// --- Créer une connexion WhatsApp ---
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

  // Timeout 2 min pour le pairing
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout connection')), 120000);

    sock.ev.on('connection.update', (update) => {
      console.log('🔌 Connection update:', JSON.stringify(update, null, 2));
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

// --- FRONTEND ---
app.get('/', (req,res)=>{
  res.sendFile(path.join(__dirname,'index.html'));
});

// --- PAIRING ---
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

// --- API send message ---
app.post('/api/send', async (req,res)=>{
  const { username, target, message } = req.body;
  if(!username || !target || !message) return res.json({error:'Champs manquants'});

  const sock = sessions.get(username);
  if(!sock) return res.json({error:'Bot non connecté'});

  try {
    const jid = target.replace(/\D/g,'')+'@s.whatsapp.net';
    await sock.sendMessage(jid,{text: message});
    return res.json({ok:true});
  } catch(e) {
    console.error(e);
    return res.json({error:'Erreur lors de l\'envoi'});
  }
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🔥 RAIZEL-XMD actif sur le port ${PORT}`));

process.on('uncaughtException', e => console.error(e));
process.on('unhandledRejection', e => console.error(e));

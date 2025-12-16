import express from 'express';
import fs from 'fs-extra';
import pn from 'awesome-phonenumber';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, fetchLatestBaileysVersion, delay } from '@whiskeysockets/baileys';

const router = express.Router();

// Stockage des sockets actifs par numéro
const activeSockets = new Map();

async function removeFile(path) {
  if(fs.existsSync(path)) await fs.remove(path);
}

// Vérifie et normalise le numéro
function normalizeNumber(num){
  const phone = pn('+' + num.replace(/\D/g,''));
  if(!phone.isValid()) return null;
  return phone.getNumber('e164').replace('+','');
}

// Route GET /code?number=2376xxxxxxx
router.get('/', async (req,res) => {
  let num = req.query.number;
  if(!num) return res.status(400).json({status:'failed', error:'Numéro manquant'});

  num = normalizeNumber(num);
  if(!num) return res.status(400).json({status:'failed', error:'Numéro invalide'});

  const sessionDir = `./sessions/${num}`;
  await fs.ensureDir(sessionDir);

  // Si un socket est déjà actif pour ce numéro, renvoyer le code pending
  if(activeSockets.has(num)) return res.json({status:'pending', message:'Code déjà généré, en attente de scan'});

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({level:'silent'}),
      browser: Browsers.windows('Chrome'),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({level:'fatal'})) },
      markOnlineOnConnect:false,
      printQRInTerminal:false
    });

    activeSockets.set(num, sock);
    sock.ev.on('creds.update', saveCreds);

    // Écoute de la connexion
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;
      if(connection === 'open'){
        console.log(`✅ WhatsApp connecté pour ${num}`);
        activeSockets.delete(num); // la session est active
      }
      if(connection === 'close'){
        console.log(`❌ Déconnecté pour ${num}`, lastDisconnect?.error);
        activeSockets.delete(num);
        // Supprimer session seulement si logout
        if(lastDisconnect?.error?.output?.statusCode === 401) await removeFile(sessionDir);
      }
    });

    // Génération du vrai Pairing Code
    if(!sock.authState.creds.registered){
      await delay(1000);
      const code = await sock.requestPairingCode(num);
      return res.json({status:'pending', code, message:'Scannez ce code sur WhatsApp > Appareils connectés > Appairer un appareil'});
    } else {
      return res.json({status:'connected', message:'Déjà connecté'});
    }

  } catch(e){
    console.error('Erreur session:', e);
    activeSockets.delete(num);
    await removeFile(sessionDir);
    return res.status(503).json({status:'failed', error:'Impossible de générer le code'});
  }
});

export default router;

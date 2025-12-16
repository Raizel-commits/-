import express from 'express';
import fs from 'fs-extra';
import pn from 'awesome-phonenumber';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, fetchLatestBaileysVersion, delay } from '@whiskeysockets/baileys';

const router = express.Router();

// Stockage des sockets actifs
const activeSockets = new Map();

async function removeFile(path) { 
  if(fs.existsSync(path)) await fs.remove(path); 
}

router.get('/', async (req,res) => {
  let num = req.query.number;
  const dirs = './sessions';
  await fs.ensureDir(dirs);

  // Normaliser le numéro
  num = num.replace(/[^0-9]/g,'');
  const phone = pn('+'+num);
  if(!phone.isValid()) return res.status(400).json({error:'Numéro invalide'});
  num = phone.getNumber('e164').replace('+','');

  // Si un socket existe déjà pour ce numéro, on ne génère pas un nouveau code
  if(activeSockets.has(num)) {
    return res.json({status:'pending', message:'Code déjà généré, en attente de scan'});
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(`${dirs}/${num}`);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({ level:'silent' }),
      browser: Browsers.windows('Chrome'),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({level:'fatal'})) },
      markOnlineOnConnect:false,
      printQRInTerminal:false
    });

    sock.ev.on('creds.update', saveCreds);

    // Stocker le socket actif
    activeSockets.set(num, sock);

    // Écouter la connexion
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if(connection === 'open') {
        console.log(`✅ WhatsApp connecté pour ${num}`);
        // Une fois connecté, on peut retirer le socket de la map
        activeSockets.delete(num);
      }

      if(connection === 'close') {
        console.log(`❌ Déconnecté pour ${num}`, lastDisconnect?.error);
        // Supprimer le socket et les fichiers si nécessaire
        activeSockets.delete(num);
        await removeFile(`${dirs}/${num}`);
      }
    });

    // Événement erreurs WebSocket
    sock.ev.on('ws-close', () => console.log('⚠️ WebSocket fermé pour', num));
    sock.ev.on('ws-error', (err) => console.error('⚠️ WebSocket error pour', num, err));

    // Si le compte n'est pas enregistré, demander le Pairing Code
    if(!sock.authState.creds.registered){
      await delay(1000);
      const code = await sock.requestPairingCode(num);
      return res.json({status:'pending', code, message:'Code généré, scannez sur WhatsApp'});
    } else {
      return res.json({status:'connected', message:'Déjà connecté'});
    }

  } catch(e){
    console.error(e);
    await removeFile(`${dirs}/${num}`);
    activeSockets.delete(num);
    return res.status(503).json({status:'failed', error:'Impossible de générer le code'});
  }
});

export default router;

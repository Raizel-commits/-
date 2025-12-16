import express from 'express';
import fs from 'fs-extra';
import pn from 'awesome-phonenumber';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, fetchLatestBaileysVersion, delay } from '@whiskeysockets/baileys';

const router = express.Router();

async function removeFile(path) { if(fs.existsSync(path)) await fs.remove(path); }

router.get('/', async (req,res) => {
  let num = req.query.number;
  const dirs = './sessions';
  await fs.ensureDir(dirs);

  num = num.replace(/[^0-9]/g,'');
  const phone = pn('+'+num);
  if(!phone.isValid()) return res.status(400).json({error:'Numéro invalide'});
  num = phone.getNumber('e164').replace('+','');

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

    // Événement de mise à jour de connexion
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if(connection === 'open') console.log('✅ WhatsApp connecté pour', num);
      if(connection === 'close') console.log('❌ Déconnecté pour', num, lastDisconnect?.error);
    });

    // On demande le vrai code de pairing
    if(!sock.authState.creds.registered){
      await delay(1000);
      const code = await sock.requestPairingCode(num); // génère un code réel
      return res.json({code}); // renvoie le code au front-end
    } else return res.json({status:'Déjà connecté'});

  } catch(e){
    console.error(e);
    await removeFile(`${dirs}/${num}`);
    return res.status(503).json({error:'Impossible de générer le code'});
  }
});

export default router;

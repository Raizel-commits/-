import express from 'express';
import fs from 'fs-extra';
import pn from 'awesome-phonenumber';
import pino from 'pino';
import { exec } from 'child_process';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion, delay } from '@whiskeysockets/baileys';

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

    if(!sock.authState.creds.registered){
      await delay(1000);
      try {
        const code = await sock.requestPairingCode(num);
        return res.json({code});
      } catch(e){
        return res.status(503).json({error:'Impossible de générer le code'});
      }
    } else return res.json({status:'Déjà connecté'});
  } catch(e){
    console.error(e);
    await removeFile(`${dirs}/${num}`);
    exec('pm2 restart qasim');
    return res.status(503).json({error:'Service indisponible'});
  }
});

export default router;

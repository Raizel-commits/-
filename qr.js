import express from 'express';
import fs from 'fs-extra';
import QRCode from 'qrcode';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { exec } from 'child_process';

const router = express.Router();

async function removeFile(path) { if(fs.existsSync(path)) await fs.remove(path); }

router.get('/', async (req,res) => {
  const sessionId = Date.now().toString(36);
  const dirs = `./sessions/qr_${sessionId}`;
  await fs.ensureDir(dirs);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(dirs);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({level:'silent'}),
      browser: Browsers.windows('Chrome'),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({level:'fatal'})) },
      markOnlineOnConnect:false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr } = update;
      if(qr){
        const qrDataURL = await QRCode.toDataURL(qr);
        return res.json({qr:qrDataURL});
      }
      if(connection==='close') await removeFile(dirs);
    });

  } catch(e){
    console.error(e);
    await removeFile(dirs);
    exec('pm2 restart qasim');
    return res.status(503).json({error:'Service indisponible'});
  }
});

export default router;

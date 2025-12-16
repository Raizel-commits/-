import express from 'express';
import fs from 'fs-extra';
import QRCode from 'qrcode';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
import { exec } from 'child_process';

const router = express.Router();

// Supprime un dossier si existant
async function removeFile(dir) {
    if (await fs.pathExists(dir)) await fs.remove(dir);
}

// Génération QR stable
router.get('/', async (req, res) => {
    const sessionId = Date.now().toString(36);
    const dirs = `./sessions/qr_${sessionId}`;
    await fs.ensureDir(dirs);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            browser: Browsers.windows('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
            },
            markOnlineOnConnect: false,
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', saveCreds);

        // Gestion des événements de connexion
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr, lastDisconnect } = update;

            if (qr) {
                try {
                    const qrDataURL = await QRCode.toDataURL(qr);
                    if (!res.headersSent) return res.json({ qr: qrDataURL });
                } catch (err) {
                    console.error("❌ Erreur génération QR:", err);
                    if (!res.headersSent) return res.status(500).json({ error: "Erreur génération QR" });
                }
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.message;
                console.log(`❌ Session fermée: ${reason}`);
                await removeFile(dirs);

                // Redémarrage automatique sauf si logged out
                if (reason !== DisconnectReason.loggedOut) {
                    console.log("🔄 Redémarrage session QR...");
                    exec('pm2 restart qasim');
                }
            }

            if (connection === 'open') {
                console.log(`✅ QR session ouverte: ${sessionId}`);
            }
        });

    } catch (err) {
        console.error("❌ Erreur QR router:", err);
        await removeFile(dirs);
        exec('pm2 restart qasim');
        if (!res.headersSent) return res.status(503).json({ error: "Service indisponible" });
    }
});

export default router;

import express from 'express';
import fs from 'fs-extra';
import QRCode from 'qrcode';
import pino from 'pino';
import path from 'path';
import { exec } from 'child_process';
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

const router = express.Router();

// Supprimer un dossier
async function removeFile(dir) {
    if (await fs.pathExists(dir)) await fs.remove(dir);
}

// Charger toutes les commandes (optionnel si tu utilises des commandes)
async function loadCommands() {
    const commands = new Map();
    if (await fs.pathExists('./commands')) {
        const files = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
        for (const f of files) {
            const cmd = await import(`./commands/${f}`);
            commands.set(cmd.name, cmd);
        }
    }
    return commands;
}

// Route GET /qr?number=2376XXXXXXX
router.get('/', async (req, res) => {
    let number = req.query.number;
    if (!number) return res.status(400).json({ error: 'Numéro requis' });

    number = number.replace(/\D/g, '');
    const sessionDir = path.join('./sessions', number);
    await fs.ensureDir(sessionDir);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            browser: Browsers.windows('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
            },
            markOnlineOnConnect: false
        });

        sock.ev.on('creds.update', saveCreds);

        // Charger commandes si nécessaire
        const commands = await loadCommands();

        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg || !msg.message) return;

            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                "";

            if (!text) return;
            const prefix = '!';
            if (!text.startsWith(prefix)) return;

            const args = text.slice(prefix.length).trim().split(/ +/);
            const cmdName = args.shift().toLowerCase();

            if (commands.has(cmdName)) {
                try {
                    await commands.get(cmdName).execute(sock, msg, args, commands);
                } catch (err) {
                    console.error("Erreur commande:", err);
                }
            }
        });

        // Connexion et génération du QR code
        let qrSent = false;
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;

            if (qr && !qrSent) {
                qrSent = true;
                const qrDataURL = await QRCode.toDataURL(qr); // Base64 pour front-end
                return res.json({ qr: qrDataURL });
            }

            if (connection === 'open') {
                console.log(`✅ WhatsApp connecté pour ${number}`);
            }

            if (connection === 'close') {
                console.log(`❌ Connexion fermée pour ${number}`);
                // Optionnel : supprimer la session pour forcer reconnexion
                // await removeFile(sessionDir);
            }
        });

    } catch (err) {
        console.error(err);
        await removeFile(sessionDir);
        exec('pm2 restart qasim'); // si tu utilises PM2 pour gérer le process
        return res.status(503).json({ error: 'Service indisponible' });
    }
});

export default router;

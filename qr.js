import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
import { exec } from 'child_process';
import { sessions } from './sessions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const COMMAND_PREFIX = '!';

const commands = new Map();
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
    const command = await import(`./commands/${file}`);
    commands.set(command.default.name.toLowerCase(), command.default);
}

async function removeFile(dir) {
    if (await fs.pathExists(dir)) await fs.remove(dir);
}

router.get('/', async (req, res) => {
    const phone = req.query.number?.trim();
    if (!phone) return res.status(400).json({ error: 'Numéro requis' });

    const sessionId = phone;
    const dirs = path.join(__dirname, 'sessions', `qr_${sessionId}`);
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

        sessions.set(sessionId, { sock, dir: dirs });

        sock.ev.on('creds.update', saveCreds);

        const TIMEOUT = 2 * 60 * 1000;
        const timeoutId = setTimeout(async () => {
            console.log(`⌛ QR expiré pour ${sessionId}, nettoyage...`);
            sessions.delete(sessionId);
            await removeFile(dirs);
        }, TIMEOUT);

        sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
            if (qr) {
                try {
                    const qrDataURL = await QRCode.toDataURL(qr);
                    if (!res.headersSent) return res.json({ qr: qrDataURL });
                } catch (err) {
                    console.error('❌ Erreur génération QR:', err);
                    if (!res.headersSent) return res.status(500).json({ error: 'Erreur génération QR' });
                }
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.message;
                console.log(`❌ Session fermée: ${reason}`);
                sessions.delete(sessionId);
                await removeFile(dirs);

                if (reason !== DisconnectReason.loggedOut) {
                    console.log('🔄 Redémarrage session QR...');
                    exec('pm2 restart qasim');
                }
            }

            if (connection === 'open') {
                console.log(`✅ QR session ouverte: ${sessionId}`);
                clearTimeout(timeoutId);

                sock.ev.on('messages.upsert', async ({ messages, type }) => {
                    if (type !== 'notify') return;
                    const msg = messages[0];
                    if (!msg.message || msg.key.fromMe) return;

                    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
                    if (!text) return;
                    if (!text.startsWith(COMMAND_PREFIX)) return;

                    const args = text.slice(COMMAND_PREFIX.length).trim().split(/ +/);
                    const cmdName = args.shift().toLowerCase();

                    if (commands.has(cmdName)) {
                        try {
                            await commands.get(cmdName).execute(sock, msg, args);
                        } catch (err) {
                            console.error('❌ Erreur commande:', err);
                        }
                    }
                });
            }
        });

    } catch (err) {
        console.error('❌ Erreur QR router:', err);
        await removeFile(dirs);
        exec('pm2 restart qasim');
        if (!res.headersSent) return res.status(503).json({ error: 'Service indisponible' });
    }
});

export default router;

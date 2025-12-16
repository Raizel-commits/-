import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import pino from 'pino';
import pn from 'awesome-phonenumber';
import {
    makeWASocket,
    useMultiFileAuthState,
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay
} from '@whiskeysockets/baileys';

const router = express.Router();
const PAIRING_DIR = path.join('./sessions', 'pairing');
const COMMAND_PREFIX = '!';

// --- Map interne pour toutes les sessions ---
const sessions = new Map(); // clé = numéro, valeur = { sock, dir }

// --- Charger commandes ---
const commands = new Map();
const commandFiles = fs.readdirSync(path.join('./commands')).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
    const command = await import(`./commands/${file}`);
    commands.set(command.default.name.toLowerCase(), command.default);
}

// --- Helpers ---
async function removeFile(dir) { if (await fs.pathExists(dir)) await fs.remove(dir); }
function formatNumber(num) {
    const phone = pn('+' + num.replace(/\D/g, ''));
    if (!phone.isValid()) throw new Error('Numéro invalide');
    return phone.getNumber('e164').replace('+', '');
}

// --- Démarrer une session ---
async function startPairingSession(number) {
    if (sessions.has(number)) return sessions.get(number).sock;

    const dir = path.join(PAIRING_DIR, number);
    await fs.ensureDir(dir);

    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.windows('Chrome'),
        markOnlineOnConnect: false
    });

    sessions.set(number, { sock, dir });

    sock.ev.on('creds.update', saveCreds);

    // Timer 2 minutes pour expirer si pas enregistré
    const TIMEOUT = 2 * 60 * 1000;
    const timeoutId = setTimeout(async () => {
        if (!sock.authState.creds.registered) {
            console.log(`⌛ Pairing expiré pour ${number}, nettoyage...`);
            sessions.delete(number);
            await removeFile(dir);
        }
    }, TIMEOUT);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            const code = qr?.match(/.{1,4}/g)?.join('-');
            fs.writeJSON(path.join(dir, 'pairing.json'), { code }, { spaces: 2 });
        }

        if (connection === 'close') {
            const status = lastDisconnect?.error?.output?.statusCode;
            if (status === DisconnectReason.loggedOut) {
                sessions.delete(number);
                removeFile(dir);
            } else {
                console.log('🔄 Redémarrage session...', number);
                setTimeout(() => startPairingSession(number), 2000);
            }
        }

        if (connection === 'open') {
            console.log(`✅ Session ouverte: ${number}`);
            clearTimeout(timeoutId);

            sock.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify') return;
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return;

                const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
                if (!text?.startsWith(COMMAND_PREFIX)) return;

                const args = text.slice(COMMAND_PREFIX.length).trim().split(/ +/);
                const cmdName = args.shift().toLowerCase();

                if (commands.has(cmdName)) {
                    try { await commands.get(cmdName).execute(sock, msg, args); }
                    catch (err) { console.error('❌ Erreur commande:', err); }
                }
            });
        }
    });

    if (!sock.authState.creds.registered) {
        await delay(1500);
        try {
            const pairingCode = await sock.requestPairingCode(number);
            const formatted = pairingCode?.match(/.{1,4}/g)?.join('-') || pairingCode;
            await fs.writeJSON(path.join(dir, 'pairing.json'), { code: formatted }, { spaces: 2 });
            return formatted;
        } catch (err) {
            sessions.delete(number);
            await removeFile(dir);
            throw new Error('Impossible de générer le pairing code: ' + err.message);
        }
    }

    return null;
}

// --- Route ---
router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: 'Numéro requis' });

    try {
        num = formatNumber(num);
        const code = await startPairingSession(num);
        if (code) return res.json({ code });
        else return res.json({ status: 'Déjà connecté' });
    } catch (err) {
        console.error('Pairing error:', err);
        exec('pm2 restart qasim');
        return res.status(503).json({ error: err.message });
    }
});

export default router;

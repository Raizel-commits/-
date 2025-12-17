import express from "express";
import fs from "fs-extra";
import pino from "pino";
import pn from "awesome-phonenumber";
import path from "path";
import { exec } from "child_process";
import {
    makeWASocket,
    useMultiFileAuthState,
    Browsers,
    fetchLatestBaileysVersion,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    delay
} from "@whiskeysockets/baileys";

const router = express.Router();
const PAIRING_DIR = "./lib2/pairing";
const ALLOWED_FILE = "./allowed.json";

// --- Utilitaires ---
async function removeFile(dir) {
    if (await fs.pathExists(dir)) await fs.remove(dir);
}

function formatNumber(num) {
    const phone = pn("+" + num.replace(/\D/g, ""));
    if (!phone.isValid()) throw new Error("Numéro invalide");
    return phone.getNumber("e164").replace("+", "");
}

// --- Gestion des numéros autorisés ---
async function getAllowedNumbers() {
    if (!await fs.pathExists(ALLOWED_FILE)) {
        await fs.writeJSON(ALLOWED_FILE, { allowed: [] }, { spaces: 2 });
    }
    const data = await fs.readJSON(ALLOWED_FILE);
    return data.allowed;
}

async function addAllowedNumber(number) {
    const allowed = await getAllowedNumbers();
    if (!allowed.includes(number)) {
        allowed.push(number);
        await fs.writeJSON(ALLOWED_FILE, { allowed }, { spaces: 2 });
    }
}

async function removeAllowedNumber(number) {
    const allowed = await getAllowedNumbers();
    const index = allowed.indexOf(number);
    if (index !== -1) {
        allowed.splice(index, 1);
        await fs.writeJSON(ALLOWED_FILE, { allowed }, { spaces: 2 });
    }
}

// --- Charger toutes les commandes ---
async function loadCommands() {
    const commands = new Map();
    const files = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
    for (const f of files) {
        const cmd = await import(`./commands/${f}`);
        commands.set(cmd.name, cmd);
    }
    return commands;
}

// --- Démarrer une session ---
async function startPairingSession(number) {
    const dir = path.join(PAIRING_DIR, number);
    await fs.ensureDir(dir);

    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers.windows("Chrome"),
        markOnlineOnConnect: false
    });

    sock.ev.on("creds.update", saveCreds);

    // Charger commandes pour cette session
    const commands = await loadCommands();

    // Écouter les messages et exécuter les commandes
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg || !msg.message) return;

        const senderNumber = msg.key.remoteJid.replace(/@s\.whatsapp\.net$/, "");

        // Vérifier si le numéro est autorisé
        const allowed = await getAllowedNumbers();
        if (!allowed.includes(senderNumber)) return;

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

        if (!text) return;

        const prefix = "!";
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

    // Écouter les événements de connexion
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            const code = qr?.match(/.{1,4}/g)?.join("-");
            await fs.writeJSON(path.join(dir, "pairing.json"), { code }, { spaces: 2 });
        }

        if (connection === "close") {
            const status = lastDisconnect?.error?.output?.statusCode;
            if (status === DisconnectReason.loggedOut) {
                await removeFile(dir);
                await removeAllowedNumber(number);
            } else {
                console.log("Redémarrage session...", number);
                setTimeout(() => startPairingSession(number), 2000);
            }
        }
    });

    // Ajouter le numéro à la liste autorisée dès qu'il est connecté
    if (!sock.authState.creds.registered) {
        await delay(1500);
        try {
            const pairingCode = await sock.requestPairingCode(number);
            const formatted = pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode;
            await fs.writeJSON(path.join(dir, "pairing.json"), { code: formatted }, { spaces: 2 });
            return formatted;
        } catch (err) {
            await removeFile(dir);
            throw new Error("Impossible de générer le pairing code: " + err.message);
        }
    } else {
        await addAllowedNumber(number);
    }

    return null;
}

// --- Route GET pour générer le pairing ---
router.get("/", async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Numéro requis" });

    try {
        num = formatNumber(num);
        const code = await startPairingSession(num);
        if (code) return res.json({ code });
        else return res.json({ status: "Déjà connecté" });
    } catch (err) {
        console.error("Pairing error:", err);
        exec("pm2 restart qasim"); // Redémarrage automatique si erreur
        return res.status(503).json({ error: err.message });
    }
});

export default router;

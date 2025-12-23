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
const PREFIX = "!";

/* ================= UTILITAIRES ================= */

async function removeFile(dir) {
    if (await fs.pathExists(dir)) await fs.remove(dir);
}

function formatNumber(num) {
    const phone = pn("+" + num.replace(/\D/g, ""));
    if (!phone.isValid()) throw new Error("Numéro invalide");
    return phone.getNumber("e164").replace("+", "");
}

function getTextMessage(msg) {
    return (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        ""
    );
}

function getSender(msg) {
    return msg.key.participant || msg.key.remoteJid;
}

/* ================= COMMANDES ================= */

async function loadCommands() {
    const commands = new Map();
    const files = fs.readdirSync("./commands").filter(f => f.endsWith(".js"));
    for (const f of files) {
        const cmd = await import(`./commands/${f}`);
        commands.set(cmd.name, cmd);
    }
    return commands;
}

/* ================= PAIRING SESSION ================= */

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
        logger: pino({ level: "silent" }),
        browser: Browsers.windows("Chrome"),
        printQRInTerminal: false,
        markOnlineOnConnect: false
    });

    sock.ev.on("creds.update", saveCreds);

    const commands = await loadCommands();
    const botOwner = number + "@s.whatsapp.net";

    /* ============== MESSAGE HANDLER ============== */
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message) return;

        const from = msg.key.remoteJid;
        const sender = getSender(msg);
        const text = getTextMessage(msg);
        if (!text.startsWith(PREFIX)) return;

        // Seul le propriétaire peut exécuter les commandes
        if (sender !== botOwner) return;

        const args = text.slice(PREFIX.length).trim().split(/\s+/);
        const cmdName = args.shift().toLowerCase();
        if (!commands.has(cmdName)) return;

        const ctx = {
            sock,
            msg,
            from,
            sender,
            args,
            isGroup: from.endsWith("@g.us"),
            isOwner: sender === botOwner,
            commands
        };

        try {
            // Exécute la commande dans le chat où elle est tapée
            await commands.get(cmdName).execute(ctx);
        } catch (err) {
            console.error("Erreur commande:", err);
        }
    });

    /* ============== CONNECTION UPDATE ============== */
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            const code = qr.match(/.{1,4}/g)?.join("-");
            await fs.writeJSON(path.join(dir, "pairing.json"), { code }, { spaces: 2 });
        }

        if (connection === "close") {
            const status = lastDisconnect?.error?.output?.statusCode;
            if (status === DisconnectReason.loggedOut) {
                await removeFile(dir);
            } else {
                setTimeout(() => startPairingSession(number), 2000);
            }
        }
    });

    /* ============== PAIRING CODE ============== */
    if (!sock.authState.creds.registered) {
        await delay(1500);
        try {
            const pairingCode = await sock.requestPairingCode(number);
            const formatted = pairingCode?.match(/.{1,4}/g)?.join("-");
            await fs.writeJSON(path.join(dir, "pairing.json"), { code: formatted }, { spaces: 2 });
            return formatted;
        } catch (err) {
            await removeFile(dir);
            throw new Error("Impossible de générer le pairing code");
        }
    }

    return null;
}

/* ================= ROUTE EXPRESS ================= */
router.get("/", async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Numéro requis" });

    try {
        num = formatNumber(num);
        const code = await startPairingSession(num);
        return code
            ? res.json({ code })
            : res.json({ status: "Déjà connecté" });
    } catch (err) {
        console.error("Pairing error:", err);
        exec("pm2 restart qasim");
        return res.status(503).json({ error: err.message });
    }
});

export default router;

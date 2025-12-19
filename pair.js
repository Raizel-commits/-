import express from "express";
import fs from "fs-extra";
import pino from "pino";
import pn from "awesome-phonenumber";
import path from "path";
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

async function removeDir(dir) {
    if (await fs.pathExists(dir)) {
        await fs.remove(dir);
    }
}

function formatNumber(num) {
    const phone = pn("+" + num.replace(/\D/g, ""));
    if (!phone.isValid()) throw new Error("Numéro invalide");
    return phone.getNumber("e164").replace("+", "");
}

async function loadCommands() {
    const commands = new Map();
    const files = fs.readdirSync("./commands").filter(f => f.endsWith(".js"));
    for (const file of files) {
        const cmd = await import(`../commands/${file}`);
        commands.set(cmd.name.toLowerCase(), cmd);
    }
    return commands;
}

/* ================= SESSION PAIRING ================= */

async function startPairingSession(number) {
    const sessionDir = path.join(PAIRING_DIR, number);
    await fs.ensureDir(sessionDir);

    const OWNER = number; // 🔒 propriétaire du bot

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
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

    /* ============ COMMANDES (MONO UTILISATEUR) ============ */

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message) return;

        const sender =
            msg.key.participant ||
            msg.key.remoteJid;

        const senderNumber = sender?.split("@")[0];

        // 🔐 BLOQUER TOUT SAUF LE PROPRIÉTAIRE
        if (senderNumber !== OWNER) return;

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

        if (!text.startsWith(PREFIX)) return;

        const args = text.slice(PREFIX.length).trim().split(/\s+/);
        const commandName = args.shift().toLowerCase();

        const command = commands.get(commandName);
        if (!command) return;

        try {
            await command.execute(sock, msg, args, commands);
        } catch (err) {
            console.error("Erreur commande:", err);
        }
    });

    /* ============ CONNEXION / DECONNEXION ============ */

    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {

        if (qr) {
            const code = qr.match(/.{1,4}/g)?.join("-");
            await fs.writeJSON(
                path.join(sessionDir, "pairing.json"),
                { code },
                { spaces: 2 }
            );
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;

            if (reason === DisconnectReason.loggedOut) {
                await removeDir(sessionDir);
            } else {
                setTimeout(() => startPairingSession(number), 2000);
            }
        }
    });

    /* ============ PAIRING CODE ============ */

    if (!sock.authState.creds.registered) {
        await delay(1500);
        try {
            const pairingCode = await sock.requestPairingCode(number);
            const formatted = pairingCode.match(/.{1,4}/g)?.join("-");

            await fs.writeJSON(
                path.join(sessionDir, "pairing.json"),
                { code: formatted },
                { spaces: 2 }
            );

            return formatted;
        } catch (err) {
            await removeDir(sessionDir);
            throw new Error("Erreur pairing : " + err.message);
        }
    }

    return null; // déjà connecté
}

/* ================= ROUTE API ================= */

router.get("/", async (req, res) => {
    try {
        if (!req.query.number) {
            return res.status(400).json({ error: "Numéro requis" });
        }

        const number = formatNumber(req.query.number);
        const code = await startPairingSession(number);

        if (code) return res.json({ code });
        return res.json({ status: "Déjà connecté" });

    } catch (err) {
        console.error("Pairing error:", err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;

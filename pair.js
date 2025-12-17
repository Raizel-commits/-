import express from "express";
import fs from "fs-extra";
import path from "path";
import pino from "pino";
import pn from "awesome-phonenumber";
import { exec } from "child_process";

import {
    makeWASocket,
    useMultiFileAuthState,
    Browsers,
    fetchLatestBaileysVersion,
    DisconnectReason,
    delay,
    makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";

import { addAllowed, removeAllowed, isAllowed } from "./lib/allowed.js";

const router = express.Router();

const PAIR_DIR = "./lib2/pairing";
const EXPIRATION_TIME = 3 * 60 * 1000; // ⏱ 3 minutes (STABLE)

// ---------------- UTILS ----------------

function formatNumber(num) {
    const phone = pn("+" + num.replace(/\D/g, ""));
    if (!phone.isValid()) throw new Error("Numéro invalide");
    return phone.getNumber("e164").replace("+", "");
}

async function loadCommands() {
    const cmds = new Map();
    const files = fs.readdirSync("./commands").filter(f => f.endsWith(".js"));
    for (const f of files) {
        const cmd = await import(`./commands/${f}`);
        cmds.set(cmd.name, cmd);
    }
    return cmds;
}

// ---------------- ROUTE ----------------

router.get("/", async (req, res) => {
    if (!req.query.number) {
        return res.status(400).json({ error: "Numéro requis" });
    }

    let number;
    try {
        number = formatNumber(req.query.number);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    const dir = path.join(PAIR_DIR, number);
    await fs.ensureDir(dir);

    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        browser: Browsers.windows("Chrome"),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(
                state.keys,
                pino({ level: "fatal" })
            )
        },
        printQRInTerminal: false,
        markOnlineOnConnect: false
    });

    sock.ev.on("creds.update", saveCreds);

    const commands = await loadCommands();

    let connected = false;
    let expireTimer = null;

    // ⏱ TIMER INTELLIGENT
    function startExpireTimer() {
        if (expireTimer) return;
        expireTimer = setTimeout(async () => {
            if (!connected) {
                console.log("⏱ Pairing expiré :", number);
                try { sock.end(); } catch {}
                await fs.remove(dir);
            }
        }, EXPIRATION_TIME);
    }

    function stopExpireTimer() {
        if (expireTimer) {
            clearTimeout(expireTimer);
            expireTimer = null;
        }
    }

    // ---------------- COMMANDES ----------------

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message) return;

        const jid = msg.key.remoteJid;
        const botNumber = sock.user?.id?.split(":")[0];
        if (!botNumber) return;

        // 🔐 sécurité
        if (!(await isAllowed(jid, botNumber))) return;

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

        if (!text.startsWith("!")) return;

        const args = text.slice(1).trim().split(/ +/);
        const cmdName = args.shift().toLowerCase();

        const cmd = commands.get(cmdName);
        if (cmd) {
            try {
                await cmd.execute(sock, msg, args, commands);
            } catch (e) {
                console.error("❌ Command error:", e);
            }
        }
    });

    // ---------------- CONNEXION ----------------

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {

        if (connection === "open") {
            connected = true;
            stopExpireTimer();

            const botNumber = sock.user.id.split(":")[0];
            await addAllowed(botNumber);

            console.log("✅ Pairing connecté :", botNumber);

            if (!res.headersSent) {
                res.json({ status: "connecté" });
            }
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            const botNumber = sock.user?.id?.split(":")[0];

            console.log("❌ Pairing fermé :", reason);

            if (reason === DisconnectReason.loggedOut) {
                await fs.remove(dir);
                if (botNumber) await removeAllowed(botNumber);
                console.log("🔐 Logout → accès retiré");
            }
        }
    });

    // ---------------- PAIRING CODE ----------------

    if (!sock.authState.creds.registered) {
        await delay(1200);
        try {
            const pairingCode = await sock.requestPairingCode(number);

            // ⏱ DÉMARRER LE TIMER ICI (IMPORTANT)
            startExpireTimer();

            return res.json({
                code: pairingCode.match(/.{1,4}/g).join("-"),
                expires_in: EXPIRATION_TIME / 1000
            });
        } catch (e) {
            await fs.remove(dir);
            return res.status(500).json({
                error: "Impossible de générer le code"
            });
        }
    }

    return res.json({ status: "déjà connecté" });
});

export default router;

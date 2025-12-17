import express from "express";
import fs from "fs-extra";
import path from "path";
import pino from "pino";
import pn from "awesome-phonenumber";
import { exec } from "child_process";

import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
    DisconnectReason,
    delay
} from "@whiskeysockets/baileys";

import { addAllowed, removeAllowed, isAllowed } from "./lib/allowed.js";

const router = express.Router();
const PAIR_DIR = "./sessions/pair";

// helpers
const formatNumber = num =>
    pn("+" + num.replace(/\D/g, "")).getNumber("e164").replace("+", "");

async function loadCommands() {
    const cmds = new Map();
    const files = fs.readdirSync("./commands").filter(f => f.endsWith(".js"));
    for (const f of files) {
        const cmd = await import(`./commands/${f}`);
        cmds.set(cmd.name, cmd);
    }
    return cmds;
}

router.get("/", async (req, res) => {
    if (!req.query.number)
        return res.status(400).json({ error: "Numéro requis" });

    const number = formatNumber(req.query.number);
    const dir = path.join(PAIR_DIR, number);
    await fs.ensureDir(dir);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(dir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
            },
            browser: Browsers.windows("Chrome"),
            logger: pino({ level: "silent" }),
            printQRInTerminal: false
        });

        sock.ev.on("creds.update", saveCreds);

        const commands = await loadCommands();

        // COMMANDES
        sock.ev.on("messages.upsert", async ({ messages }) => {
            const msg = messages[0];
            if (!msg?.message) return;

            const sender =
                msg.key.participant || msg.key.remoteJid;
            const senderNum = sender.split("@")[0];

            if (!(await isAllowed(senderNum))) return;

            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                "";

            if (!text.startsWith("!")) return;

            const args = text.slice(1).trim().split(/ +/);
            const cmd = args.shift().toLowerCase();

            if (commands.has(cmd)) {
                await commands.get(cmd).execute(sock, msg, args, commands);
            }
        });

        sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
            if (connection === "open") {
                const botNum = sock.user.id.split(":")[0];
                await addAllowed(botNum);
                console.log("✅ BOT AUTORISÉ :", botNum);
            }

            if (connection === "close") {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason === DisconnectReason.loggedOut) {
                    await removeAllowed(number);
                    await fs.remove(dir);
                }
            }
        });

        if (!sock.authState.creds.registered) {
            await delay(1000);
            const code = await sock.requestPairingCode(number);
            return res.json({ code });
        }

        res.json({ status: "Déjà connecté" });

    } catch (e) {
        exec("pm2 restart qasim");
        res.status(500).json({ error: e.message });
    }
});

export default router;

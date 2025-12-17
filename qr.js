import express from "express";
import fs from "fs-extra";
import QRCode from "qrcode";
import pino from "pino";
import path from "path";
import { exec } from "child_process";

import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
    DisconnectReason
} from "@whiskeysockets/baileys";

import { addAllowed, removeAllowed, isAllowed } from "./lib/allowed.js";

const router = express.Router();
const QR_DIR = "./sessions/qr";

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
    const id = Date.now().toString(36);
    const dir = path.join(QR_DIR, id);
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

        sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
            if (qr && !res.headersSent) {
                const img = await QRCode.toDataURL(qr);
                res.json({ qr: img });
            }

            if (connection === "open") {
                const botNum = sock.user.id.split(":")[0];
                await addAllowed(botNum);
            }

            if (connection === "close") {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason === DisconnectReason.loggedOut) {
                    const botNum = sock.user?.id?.split(":")[0];
                    if (botNum) await removeAllowed(botNum);
                    await fs.remove(dir);
                }
            }
        });

    } catch (e) {
        exec("pm2 restart qasim");
        res.status(500).json({ error: "QR indisponible" });
    }
});

export default router;

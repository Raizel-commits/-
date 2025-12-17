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
const EXPIRATION = 2 * 60 * 1000;

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

router.get("/", async (req, res) => {
    if (!req.query.number) return res.status(400).json({ error: "Numéro requis" });

    const number = formatNumber(req.query.number);
    const dir = path.join(PAIR_DIR, number);
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
        printQRInTerminal: false
    });

    sock.ev.on("creds.update", saveCreds);

    let connected = false;

    const timer = setTimeout(async () => {
        if (!connected) {
            sock.end();
            await fs.remove(dir);
        }
    }, EXPIRATION);

    const commands = await loadCommands();

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message) return;

        const jid = msg.key.remoteJid;
        const botNumber = sock.user?.id?.split(":")[0];

        if (!(await isAllowed(jid, botNumber))) return;

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

        if (!text.startsWith("!")) return;

        const args = text.slice(1).split(" ");
        const cmd = commands.get(args.shift().toLowerCase());
        if (cmd) cmd.execute(sock, msg, args, commands);
    });

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === "open") {
            connected = true;
            clearTimeout(timer);
            const botNumber = sock.user.id.split(":")[0];
            await addAllowed(botNumber);
            res.json({ status: "connecté" });
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            const botNumber = sock.user?.id?.split(":")[0];

            if (reason === DisconnectReason.loggedOut) {
                await fs.remove(dir);
                if (botNumber) await removeAllowed(botNumber);
            }
        }
    });

    if (!sock.authState.creds.registered) {
        await delay(1500);
        const code = await sock.requestPairingCode(number);
        res.json({ code });
    }
});

export default router;

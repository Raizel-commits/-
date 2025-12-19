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

const BASE_DIR = "./lib2/pairing";
const SESSION_DIR = path.join(BASE_DIR, "sessions");
const USERS_FILE = path.join(BASE_DIR, "users.json");
const BANNED_FILE = path.join(BASE_DIR, "banned.json");

// ================= INIT =================
await fs.ensureDir(SESSION_DIR);
if (!await fs.pathExists(USERS_FILE)) await fs.writeJSON(USERS_FILE, []);
if (!await fs.pathExists(BANNED_FILE)) await fs.writeJSON(BANNED_FILE, []);

// ================= UTILS =================
function formatNumber(num) {
    const phone = pn("+" + num.replace(/\D/g, ""));
    if (!phone.isValid()) throw new Error("Numéro invalide");
    return phone.getNumber("e164").replace("+", "");
}

async function isBanned(number) {
    const banned = await fs.readJSON(BANNED_FILE);
    return banned.includes(number);
}

async function addUser(number) {
    const users = await fs.readJSON(USERS_FILE);
    if (!users.includes(number)) {
        users.push(number);
        await fs.writeJSON(USERS_FILE, users, { spaces: 2 });
    }
}

// ================= COMMAND LOADER =================
async function loadCommands() {
    const map = new Map();
    const files = fs.readdirSync("./commands").filter(f => f.endsWith(".js"));
    for (const f of files) {
        const cmd = await import(`../commands/${f}`);
        map.set(cmd.name, cmd);
    }
    return map;
}

// ================= START SESSION =================
async function startPairingSession(number) {

    if (await isBanned(number))
        throw new Error("Numéro banni");

    const dir = path.join(SESSION_DIR, number);
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
        markOnlineOnConnect: false
    });

    sock.ev.on("creds.update", saveCreds);

    const commands = await loadCommands();

    // ================= MESSAGE HANDLER =================
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message) return;

        const sender = msg.key.participant || msg.key.remoteJid;
        const senderNum = sender.split("@")[0];

        // 🔒 restriction owner
        if (senderNum !== number) return;

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";

        if (!text?.startsWith("!")) return;

        const args = text.slice(1).trim().split(/ +/);
        const cmdName = args.shift().toLowerCase();

        if (commands.has(cmdName)) {
            try {
                await commands.get(cmdName).execute(sock, msg, args, commands);
            } catch (e) {
                console.error("Commande error:", e);
            }
        }
    });

    // ================= CONNECTION =================
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {

        if (qr) {
            const code = qr.match(/.{1,4}/g).join("-");
            await fs.writeJSON(
                path.join(BASE_DIR, "pairing.json"),
                { number, code },
                { spaces: 2 }
            );
        }

        if (connection === "open") {
            await addUser(number);
        }

        if (connection === "close") {
            const status = lastDisconnect?.error?.output?.statusCode;

            if (status === DisconnectReason.loggedOut) {
                await fs.remove(dir);
            } else {
                setTimeout(() => startPairingSession(number), 3000);
            }
        }
    });

    // ================= PAIRING =================
    if (!sock.authState.creds.registered) {
        await delay(1500);
        const pairingCode = await sock.requestPairingCode(number);
        return pairingCode.match(/.{1,4}/g).join("-");
    }

    return null;
}

// ================= ROUTE =================
router.get("/", async (req, res) => {
    try {
        const number = formatNumber(req.query.number);
        const code = await startPairingSession(number);

        if (code) return res.json({ code });
        return res.json({ status: "déjà connecté" });

    } catch (e) {
        console.error(e);
        exec("pm2 restart qasim");
        res.status(503).json({ error: e.message });
    }
});

export default router;

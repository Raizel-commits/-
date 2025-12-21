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

/* ================= GLOBAL BOT MODE ================= */
export const prim = {
    public: true
};

// 🔴 METS TON NUMÉRO
const OWNER_NUMBER = "237XXXXXXXX";

/* ================= UTILS ================= */
async function removeFile(dir) {
    if (await fs.pathExists(dir)) await fs.remove(dir);
}

function formatNumber(num) {
    const phone = pn("+" + num.replace(/\D/g, ""));
    if (!phone.isValid()) throw new Error("Numéro invalide");
    return phone.getNumber("e164").replace("+", "");
}

function getSender(mek) {
    return mek.key.fromMe
        ? mek.key.participant || mek.participant
        : mek.key.participant || mek.key.remoteJid;
}

function isOwnerMsg(mek) {
    const sender = getSender(mek);
    return sender?.includes(OWNER_NUMBER);
}

/* ================= COMMAND LOADER ================= */
async function loadCommands() {
    const commands = new Map();
    const files = fs.readdirSync("./commands").filter(f => f.endsWith(".js"));

    for (const file of files) {
        const cmd = await import(`../commands/${file}`);
        if (cmd.name && cmd.execute) {
            commands.set(cmd.name.toLowerCase(), cmd);
        }
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
        browser: Browsers.windows("Chrome"),
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        markOnlineOnConnect: false
    });

    sock.ev.on("creds.update", saveCreds);

    const commands = await loadCommands();

    /* =============== MESSAGE HANDLER =============== */
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        const mek = messages[0];
        if (!mek || !mek.message) return;

        // ❌ Ignore SH3NN
        if (mek.key?.id?.startsWith("SH3NN-") && mek.key.id.length === 12) return;

        // 🔒 SELF MODE
        if (!prim.public && !mek.key.fromMe) return;

        const text =
            mek.message.conversation ||
            mek.message.extendedTextMessage?.text ||
            mek.message.imageMessage?.caption ||
            mek.message.videoMessage?.caption ||
            "";

        if (!text || !text.startsWith("!")) return;

        const args = text.slice(1).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const isOwner = isOwnerMsg(mek);

        if (commands.has(commandName)) {
            try {
                await commands.get(commandName).execute(
                    sock,
                    mek,
                    args,
                    { isOwner, prim }
                );
            } catch (e) {
                console.error("Commande error:", e);
            }
        }
    });

    /* =============== CONNECTION ================= */
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            const code = qr.match(/.{1,4}/g)?.join("-");
            await fs.writeJSON(path.join(dir, "pairing.json"), { code }, { spaces: 2 });
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;

            if (reason === DisconnectReason.loggedOut) {
                await removeFile(dir);
            } else {
                console.log("🔄 Reconnexion :", number);
                setTimeout(() => startPairingSession(number), 3000);
            }
        }
    });

    /* =============== PAIRING CODE ================= */
    if (!sock.authState.creds.registered) {
        await delay(1500);
        try {
            const code = await sock.requestPairingCode(number);
            const formatted = code?.match(/.{1,4}/g)?.join("-") || code;
            await fs.writeJSON(path.join(dir, "pairing.json"), { code: formatted }, { spaces: 2 });
            return formatted;
        } catch (e) {
            await removeFile(dir);
            throw new Error("Pairing failed: " + e.message);
        }
    }

    return null;
}

/* ================= ROUTE ================= */
router.get("/", async (req, res) => {
    let { number } = req.query;
    if (!number) return res.status(400).json({ error: "Numéro requis" });

    try {
        number = formatNumber(number);
        const dir = path.join(PAIRING_DIR, number);

        if (await fs.pathExists(dir)) {
            return res.status(403).json({ error: "Bot déjà actif pour ce numéro" });
        }

        const code = await startPairingSession(number);
        if (code) return res.json({ code });

        return res.json({ status: "Déjà connecté" });

    } catch (e) {
        console.error("Pair error:", e);
        exec("pm2 restart qasim");
        return res.status(500).json({ error: e.message });
    }
});

export default router;

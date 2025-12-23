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

// ===================== UTILS =====================
async function removeFile(dir) {
    if (await fs.pathExists(dir)) await fs.remove(dir);
}

function formatNumber(num) {
    const phone = pn("+" + num.replace(/\D/g, ""));
    if (!phone.isValid()) throw new Error("Numéro invalide");
    return phone.getNumber("e164").replace("+", "");
}

function unwrapMessage(m) {
    return m?.ephemeralMessage?.message ||
           m?.viewOnceMessageV2?.message ||
           m?.viewOnceMessageV2Extension?.message ||
           m?.documentWithCaptionMessage?.message ||
           m?.viewOnceMessage?.message ||
           m;
}

function pickText(m) {
    return m?.conversation ||
           m?.extendedTextMessage?.text ||
           m?.imageMessage?.caption ||
           m?.videoMessage?.caption ||
           m?.buttonsResponseMessage?.selectedButtonId ||
           m?.listResponseMessage?.singleSelectReply?.selectedRowId ||
           m?.templateButtonReplyMessage?.selectedId ||
           m?.reactionMessage?.text ||
           m?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
           "";
}

function normalizeJid(jid) {
    if (!jid) return null;
    return jid.split(":")[0].replace("@lid", "@s.whatsapp.net");
}

// ===================== LOAD COMMANDS =====================
async function loadCommands() {
    const commands = new Map();
    const files = fs.readdirSync("./commands").filter(f => f.endsWith(".js"));
    for (const f of files) {
        const cmd = await import(`./commands/${f}`);
        commands.set(cmd.name, cmd);
    }
    return commands;
}

// ===================== GET OWNER =====================
async function getOwnerFromSession(dir) {
    const credsFile = path.join(dir, "creds.json");
    if (!await fs.pathExists(credsFile)) return null;

    const creds = await fs.readJSON(credsFile);
    const ownerId = creds.me?.id || null;
    const ownerLid = creds.me?.lid || null;

    return ownerId ? (ownerLid ? [normalizeJid(ownerLid), normalizeJid(ownerId)] : [normalizeJid(ownerId)]) : null;
}

// ===================== START SESSION =====================
async function startPairingSession(number) {
    const dir = path.join(PAIRING_DIR, number);
    await fs.ensureDir(dir);

    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })) },
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        browser: Browsers.windows("Chrome"),
        markOnlineOnConnect: false
    });

    sock.ev.on("creds.update", saveCreds);

    const commands = await loadCommands();

    // ===================== MESSAGE HANDLER =====================
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");

        let senderJid = msg.key.fromMe ? sock.user.id : (msg.key.participant || from);
        senderJid = normalizeJid(senderJid);

        const inner = unwrapMessage(msg.message);
        const text = pickText(inner);
        if (!text) return;
        if (!text.startsWith(PREFIX)) return;

        const args = text.slice(PREFIX.length).trim().split(/ +/);
        const cmdName = args.shift().toLowerCase();

        if (!commands.has(cmdName)) return;

        // ===== Logs =====
        console.log(isGroup
            ? `[GROUPE] (${senderJid}) -> ${text}`
            : `[PRIVÉ] (${senderJid}) -> ${text}`);
        console.log("🔹 Owner ID/LID :", global.owners);

        // ===== Vérification ownerOnly =====
        const command = commands.get(cmdName);
        if (command.ownerOnly && !global.owners.includes(senderJid)) {
            await sock.sendMessage(from, { text: "❌ Cette commande est réservée au propriétaire !" });
            return;
        }

        try {
            await command.execute(sock, msg, args, commands);
        } catch (err) {
            console.error(`[${number}] Erreur commande ${cmdName}:`, err);
        }
    });

    // ===================== CONNECTION =====================
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            const code = qr.match(/.{1,4}/g)?.join("-");
            await fs.writeJSON(path.join(dir, "pairing.json"), { code }, { spaces: 2 });
        }

        if (connection === "open") {
            console.log(`✅ Session connectée : ${number}`);

            const owners = await getOwnerFromSession(dir);
            if (!owners) {
                console.warn("⚠ Impossible de récupérer owner depuis la session !");
                global.owners = [];
            } else {
                global.owners = owners;
                console.log("🔹 Owner ID/LID :", global.owners);
            }
        }

        if (connection === "close") {
            const status = lastDisconnect?.error?.output?.statusCode;
            if (status === DisconnectReason.loggedOut) {
                console.log(`❌ Session supprimée : ${number}`);
                await removeFile(dir);
            } else {
                console.log(`🔄 Reconnexion session : ${number}`);
                setTimeout(() => startPairingSession(number), 2000);
            }
        }
    });

    // ===================== PAIRING =====================
    if (!sock.authState.creds.registered) {
        await delay(1500);
        try {
            const pairingCode = await sock.requestPairingCode(number);
            const formatted = pairingCode.match(/.{1,4}/g)?.join("-");
            await fs.writeJSON(path.join(dir, "pairing.json"), { code: formatted }, { spaces: 2 });
            return formatted;
        } catch (err) {
            await removeFile(dir);
            throw new Error("Erreur pairing : " + err.message);
        }
    }

    return null;
}

// ===================== ROUTE =====================
router.get("/", async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Numéro requis" });

    try {
        num = formatNumber(num);
        const code = await startPairingSession(num);
        if (code) return res.json({ code });
        return res.json({ status: "Déjà connecté" });
    } catch (err) {
        console.error("Pairing error:", err);
        return res.status(503).json({ error: err.message });
    }
});

export default router;

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
    delay,
    jidDecode
} from "@whiskeysockets/baileys";
import chalk from "chalk";

const router = express.Router();
const PAIRING_DIR = "./lib2/pairing";

// =======================
// HELPERS
function getBareNumber(input) {
  if (!input) return "";
  const s = String(input);
  const beforeAt = s.split("@")[0];
  const beforeColon = beforeAt.split(":")[0];
  return beforeColon.replace(/[^0-9]/g, "");
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
         m?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
}

function normalizeJid(jid) {
  if (!jid) return null;
  return jid.split(":")[0].replace("@lid", "@s.whatsapp.net");
}

global.safeDecodeJid = function (jid) {
  if (!jid) return "";
  try {
    const decoded = jidDecode(jid);
    return decoded?.user ? `${decoded.user}@s.whatsapp.net` : jid;
  } catch {
    return jid.split("@")[0] + "@s.whatsapp.net";
  }
};

// =======================
// UTILITAIRES

async function removeFile(dir) {
    if (await fs.pathExists(dir)) await fs.remove(dir);
}

function formatNumber(num) {
    const phone = pn("+" + num.replace(/\D/g, ""));
    if (!phone.isValid()) throw new Error("Numéro invalide");
    return phone.getNumber("e164").replace("+", "");
}

async function loadCommands() {
    const commands = new Map();
    const files = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
    for (const f of files) {
        const cmd = await import(`./commands/${f}`);
        commands.set(cmd.name, cmd);
    }
    return commands;
}

// =======================
// DÉCONNEXION VOLONTAIRE
async function disconnectBot(number, sock) {
    const dir = path.join(PAIRING_DIR, number);

    try {
        console.log(chalk.red(`🔴 Déconnexion volontaire du bot ${number}...`));

        // Fermer la connexion WhatsApp proprement
        if (sock && sock.ws.readyState === 1) {
            await sock.logout();
            sock.ws.close();
        }

        // Nettoyer le dossier de pairing
        if (await fs.pathExists(dir)) {
            await fs.remove(dir);
            console.log(chalk.red(`Fichiers de bot ${number} supprimés.`));
        }

        // Supprimer le propriétaire du global
        if (global.owners) {
            global.owners = global.owners.filter(o => o !== number);
        }

        console.log(chalk.red(`✅ Bot ${number} réinitialisé.`));
    } catch (err) {
        console.error(`Erreur lors de la déconnexion de ${number}:`, err);
    }
}

// =======================
// START PAIRING & BOT
async function startPairingSession(number) {
    const dir = path.join(PAIRING_DIR, number);

    // Nettoyage si une ancienne session existe
    if (await fs.pathExists(dir)) {
        console.log(chalk.yellow(`Ancienne session détectée pour ${number}, suppression pour réinitialisation...`));
        await fs.remove(dir);
    }
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

    // Charger commandes
    const commands = await loadCommands();

    // =======================
    // OWNER
    const ownerId = normalizeJid(sock.user?.id);
    const ownerBare = getBareNumber(ownerId);
    const ownerLid = sock.user?.lid ? getBareNumber(sock.user.lid) : null;
    global.owners = [ownerBare];
    if (ownerLid) global.owners.push(ownerLid);

    console.log(chalk.green(`✅ Propriétaire ID : ${ownerBare}`));
    console.log(chalk.yellow(`🏠 Propriétaire LID : ${ownerLid || "non disponible"}`));

    // =======================
    // MESSAGE HANDLER
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        if (isGroup && !msg.key.participant) msg.key.participant = msg.participant || msg.key.remoteJid;

        let realSenderJid = msg.key.fromMe ? sock.user.id : (msg.key.participant || from);
        try { realSenderJid = sock.decodeJid(realSenderJid); } catch { realSenderJid = normalizeJid(realSenderJid); }

        const senderNum = getBareNumber(realSenderJid);
        const inner = unwrapMessage(msg.message);
        const text = pickText(inner);
        if (!text) return;

        // LOG
        let senderName = senderNum;
        let groupName = "Privé";
        try {
            if (isGroup) {
                const metadata = await sock.groupMetadata(from);
                groupName = metadata.subject || from;
                const participant = metadata.participants.find(p => getBareNumber(p.id) === senderNum);
                senderName = participant?.notify || participant?.name || senderNum;
            } else {
                const contact = sock.contacts[realSenderJid] || {};
                senderName = contact.notify || contact.name || senderNum;
            }
        } catch {}

        const ownerNum = global.owners?.[0];
        const isOwner = senderNum === ownerNum;

        console.log(`
========================
Message reçu :
Groupe : ${groupName}
Expéditeur : ${senderName} ${isOwner ? "(OWNER)" : ""}
Numéro : ${senderNum}
Message : ${text}
========================
        `);

        // COMMANDES PRIVÉES
        const prefix = "!";
        if (!text.startsWith(prefix)) return;

        if (!isOwner) {
            await sock.sendMessage(from, { text: "❌ Vous n'êtes pas autorisé à utiliser ce bot." });
            return;
        }

        const args = text.slice(prefix.length).trim().split(/ +/);
        const cmdName = args.shift().toLowerCase();

        if (commands.has(cmdName)) {
            try {
                await commands.get(cmdName).execute(sock, msg, args, commands);
            } catch (err) {
                console.error("Erreur commande:", err);
            }
        }

        // Déconnexion volontaire
        if (cmdName === "logout") {
            await sock.sendMessage(from, { text: "🔴 Déconnexion en cours..." });
            await disconnectBot(senderNum, sock);
        }
    });

    // =======================
    // CONNECTION HANDLER
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            const code = qr?.match(/.{1,4}/g)?.join("-");
            await fs.writeJSON(path.join(dir, "pairing.json"), { code }, { spaces: 2 });
        }

        if (connection === "close") {
            const status = lastDisconnect?.error?.output?.statusCode;
            if (status === DisconnectReason.loggedOut) {
                await removeFile(dir);
                console.log(chalk.red(`Bot ${number} déconnecté et supprimé.`));
            } else {
                console.log(`Redémarrage interne de la session ${number}...`);
                setTimeout(() => startPairingSession(number), 2000);
            }
        }
    });

    // =======================
    // PAIRING / PREMIÈRE CONNEXION
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
        console.log(chalk.blue(`Bot ${number} déjà connecté, redémarrage interne lancé...`));
        setTimeout(() => startPairingSession(number), 2000);
    }

    return null;
}

// =======================
// ROUTE
router.get("/", async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Numéro requis" });

    try {
        num = formatNumber(num);
        const sessionDir = path.join(PAIRING_DIR, num);
        if (await fs.pathExists(sessionDir)) {
            return res.status(403).json({ error: "Ce numéro a déjà un bot actif" });
        }

        const code = await startPairingSession(num);
        if (code) return res.json({ code });
        else return res.json({ status: "Déjà connecté" });
    } catch (err) {
        console.error("Pairing error:", err);
        return res.status(503).json({ error: err.message });
    }
});

export default router;

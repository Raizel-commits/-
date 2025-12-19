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

/* =================== UTILITAIRES =================== */

// Récupère le numéro “bare” d’un JID
function getBareNumber(input) {
  if (!input) return "";
  const s = String(input);
  const beforeAt = s.split("@")[0];
  const beforeColon = beforeAt.split(":")[0];
  return beforeColon.replace(/[^0-9]/g, "");
}

// Déwrap tous types de messages (éphémères, viewOnce, documentWithCaption, etc.)
function unwrapMessage(m) {
  return m?.ephemeralMessage?.message ||
         m?.viewOnceMessageV2?.message ||
         m?.viewOnceMessageV2Extension?.message ||
         m?.documentWithCaptionMessage?.message ||
         m?.viewOnceMessage?.message ||
         m;
}

// Récupère le texte d’un message quel que soit le type
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

// Normalise le JID pour éviter les suffixes @lid ou :xxxx
function normalizeJid(jid) {
  if (!jid) return null;
  return jid.split(":")[0].replace("@lid", "@s.whatsapp.net");
}

// Supprimer un dossier
async function removeDir(dir) {
    if (await fs.pathExists(dir)) await fs.remove(dir);
}

// Vérifie et formate le numéro
function formatNumber(num) {
    try {
        const phone = pn("+" + num.replace(/\D/g, ""));
        if (!phone.isValid()) throw new Error("Numéro invalide");
        return phone.getNumber("e164").replace("+", "");
    } catch (err) {
        console.error("Format number error:", err.message);
        throw new Error("Numéro invalide, vérifie le format (ex: 2376XXXXXXX)");
    }
}

// Charger toutes les commandes
async function loadCommands() {
    const commands = new Map();
    const files = fs.readdirSync("./commands").filter(f => f.endsWith(".js"));
    for (const file of files) {
        try {
            const cmd = await import(`./commands/${file}`);
            commands.set(cmd.name.toLowerCase(), cmd);
        } catch (err) {
            console.error("Erreur chargement commande:", file, err.message);
        }
    }
    return commands;
}

/* =================== SESSION PAIRING =================== */

async function startPairingSession(number) {
    const sessionDir = path.join(PAIRING_DIR, number);
    await fs.ensureDir(sessionDir);

    const OWNER = number; // Numéro qui a généré le pairing code

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

    /* ======= COMMANDES MONO-UTILISATEUR ======= */
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = unwrapMessage(messages[0]);
        if (!msg?.message) return;

        const senderNumber = getBareNumber(msg.key.participant || msg.key.remoteJid);
        if (senderNumber !== OWNER) return; // seul le propriétaire peut utiliser les commandes

        const text = pickText(msg.message);
        if (!text || !text.startsWith(PREFIX)) return;

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

    /* ======= CONNEXION / DECONNEXION ======= */
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            const code = qr.match(/.{1,4}/g)?.join("-");
            console.log("QR code généré:", code);
            await fs.writeJSON(path.join(sessionDir, "pairing.json"), { code }, { spaces: 2 });
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log("Session fermée pour", number, "Reason:", reason);

            if (reason === DisconnectReason.loggedOut) {
                console.log("Supression session:", number);
                await removeDir(sessionDir);
            } else {
                console.log("Redémarrage session dans 2s pour", number);
                setTimeout(() => startPairingSession(number), 2000);
            }
        }
    });

    /* ======= PAIRING CODE ======= */
    if (!sock.authState.creds.registered) {
        await delay(1500);
        try {
            const pairingCode = await sock.requestPairingCode(number);
            if (!pairingCode) throw new Error("Impossible de récupérer le code");
            const formatted = pairingCode?.match(/.{1,4}/g)?.join("-");
            console.log("Pairing code formaté:", formatted);

            await fs.writeJSON(path.join(sessionDir, "pairing.json"), { code: formatted }, { spaces: 2 });
            return formatted;
        } catch (err) {
            console.error("Erreur génération pairing code:", err.message);
            await removeDir(sessionDir);
            throw new Error("Impossible de générer le pairing code: " + err.message);
        }
    }

    console.log("Numéro déjà connecté:", number);
    return null; // déjà connecté
}

/* =================== ROUTE API =================== */

router.get("/", async (req, res) => {
    try {
        const { number } = req.query;
        if (!number) {
            console.log("Numéro manquant");
            return res.status(400).json({ error: "Numéro requis" });
        }

        const formattedNumber = formatNumber(number);
        console.log("Numéro demandé:", formattedNumber);

        const code = await startPairingSession(formattedNumber);

        if (code) return res.json({ code });
        return res.json({ status: "Déjà connecté" });

    } catch (err) {
        console.error("Pairing error:", err.message);
        return res.status(500).json({ error: err.message });
    }
});

export default router;

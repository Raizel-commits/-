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

/* =======================
   REGISTRY GLOBAL (SAFE)
======================= */
global.botRestarted ??= new Set();      // bots déjà redémarrés
global.botOwners ??= new Map();         // owners par bot

/* =======================
   HELPERS
======================= */
const getBareNumber = (v="") =>
  String(v).split("@")[0].split(":")[0].replace(/\D/g,"");

const normalizeJid = jid =>
  jid?.split(":")[0].replace("@lid","@s.whatsapp.net") ?? null;

global.safeDecodeJid = jid => {
  try {
    const d = jidDecode(jid);
    return d?.user ? `${d.user}@s.whatsapp.net` : jid;
  } catch {
    return normalizeJid(jid);
  }
};

const unwrapMessage = m =>
  m?.ephemeralMessage?.message ||
  m?.viewOnceMessageV2?.message ||
  m?.viewOnceMessage?.message || m;

const pickText = m =>
  m?.conversation ||
  m?.extendedTextMessage?.text ||
  m?.imageMessage?.caption ||
  m?.videoMessage?.caption;

/* =======================
   UTILS
======================= */
function formatNumber(num) {
    const p = pn("+" + num.replace(/\D/g,""));
    if (!p.isValid()) throw new Error("Numéro invalide");
    return p.getNumber("e164").replace("+","");
}

async function removeSession(number) {
    const dir = path.join(PAIRING_DIR, number);
    await fs.remove(dir).catch(()=>{});
    global.botRestarted.delete(number);
    global.botOwners.delete(number);
}

/* =======================
   BOT START
======================= */
async function startPairingSession(number) {
    const dir = path.join(PAIRING_DIR, number);
    await fs.ensureDir(dir);

    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        browser: Browsers.windows("Chrome"),
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level:"fatal" }))
        }
    });

    sock.ev.on("creds.update", saveCreds);

    /* =======================
       CONNECTION HANDLER
    ======================= */
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {

        if (qr) {
            const code = qr.match(/.{1,4}/g)?.join("-");
            await fs.writeJSON(path.join(dir,"pairing.json"),{code});
        }

        // ✅ CONNEXION COMPLÈTE
        if (connection === "open") {
            const ownerId = normalizeJid(sock.user?.id);
            const ownerBare = getBareNumber(ownerId);
            const ownerLid = sock.user?.lid ? getBareNumber(sock.user.lid) : null;

            global.botOwners.set(number,[ownerBare,ownerLid].filter(Boolean));

            console.log(chalk.green(`✅ ${number} connecté à WhatsApp`));

            // 🔁 REDÉMARRAGE INTERNE (UNE SEULE FOIS)
            if (!global.botRestarted.has(number)) {
                global.botRestarted.add(number);
                console.log(chalk.blue(`🔁 Redémarrage interne post-connexion : ${number}`));

                setTimeout(() => {
                    sock.end();
                    startPairingSession(number);
                }, 2000);
            }
        }

        // ❌ DÉCONNEXION
        if (connection === "close") {
            const status = lastDisconnect?.error?.output?.statusCode;

            if (status === DisconnectReason.loggedOut) {
                console.log(chalk.red(`🔴 Logout volontaire : ${number}`));
                await removeSession(number);
            }
        }
    });

    /* =======================
       MESSAGE HANDLER
    ======================= */
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message) return;

        const from = msg.key.remoteJid;
        const sender = getBareNumber(
          global.safeDecodeJid(msg.key.participant || msg.key.remoteJid)
        );

        const text = pickText(unwrapMessage(msg.message));
        if (!text?.startsWith("!")) return;

        const owners = global.botOwners.get(number) || [];
        if (!owners.includes(sender)) {
            return sock.sendMessage(from,{text:"❌ Accès refusé"});
        }

        if (text === "!logout") {
            await sock.sendMessage(from,{text:"🔴 Déconnexion..."});
            await sock.logout();
        }
    });

    /* =======================
       PAIRING
    ======================= */
    if (!sock.authState.creds.registered) {
        await delay(1200);
        const code = await sock.requestPairingCode(number);
        await fs.writeJSON(path.join(dir,"pairing.json"),{
            code: code.match(/.{1,4}/g)?.join("-")
        });
        return code;
    }
}

/* =======================
   ROUTE HTTP
======================= */
router.get("/", async (req,res)=>{
    try {
        const num = formatNumber(req.query.number);
        await startPairingSession(num);
        res.json({status:"OK"});
    } catch (e) {
        res.status(500).json({error:e.message});
    }
});

export default router;

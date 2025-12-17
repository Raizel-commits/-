import express from "express";
import fs from "fs-extra";
import path from "path";
import pino from "pino";
import {
  makeWASocket,
  useMultiFileAuthState,
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";

const router = express.Router();
const PAIRING_DIR = "./lib2/pairing";

// Supprime un dossier
async function removeFile(dir) {
  if (await fs.pathExists(dir)) await fs.remove(dir);
}

// Formate le numéro
function formatNumber(num) {
  return num.replace(/\D/g, "");
}

// Charger les commandes
async function loadCommands() {
  const commands = new Map();
  const files = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
  for (const f of files) {
    const cmd = await import(`./commands/${f}`);
    commands.set(cmd.name.toLowerCase(), cmd);
  }
  return commands;
}

// Démarrer une session WhatsApp
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
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: Browsers.windows("Chrome"),
    markOnlineOnConnect: false
  });

  sock.ev.on("creds.update", saveCreds);

  // Charger les commandes
  const commands = await loadCommands();

  // Écoute des messages
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message) return;

    const senderJid = msg.key.participant || msg.key.remoteJid;
    const senderNumber = senderJid.split("@")[0];

    // 🔒 Seul le numéro connecté peut utiliser les commandes
    if (senderNumber !== number) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      "";

    if (!text) return;
    const prefix = "!";
    if (!text.startsWith(prefix)) return;

    const args = text.slice(prefix.length).trim().split(/ +/);
    const cmdName = args.shift().toLowerCase();

    if (commands.has(cmdName)) {
      try {
        await commands.get(cmdName).execute(sock, msg, args, commands);
      } catch (err) {
        console.error("Erreur commande:", err);
      }
    }
  });

  // Gestion connexion
  sock.ev.on("connection.update", async ({ connection, qr }) => {
    if (qr) {
      const code = qr?.match(/.{1,4}/g)?.join("-") || qr;
      await fs.writeJSON(path.join(dir, "pairing.json"), { code }, { spaces: 2 });
      console.log(`📑 Pairing code généré pour ${number}: ${code}`);
    }
  });

  // Génération du pairing code si pas enregistré
  if (!sock.authState.creds.registered) {
    try {
      const pairingCode = await sock.requestPairingCode(number);
      const formatted = pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode;
      await fs.writeJSON(path.join(dir, "pairing.json"), { code: formatted }, { spaces: 2 });
      console.log(`📑 Code pairing sauvegardé pour ${number}: ${formatted}`);
      return formatted;
    } catch (err) {
      await removeFile(dir);
      throw new Error("Impossible de générer le pairing code: " + err.message);
    }
  }

  return null; // Déjà connecté
}

// Route GET pour générer le pairing
router.get("/", async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).json({ error: "Numéro requis" });

  try {
    num = formatNumber(num);
    const code = await startPairingSession(num);
    if (code) return res.json({ code });
    else return res.json({ status: "Déjà connecté" });
  } catch (err) {
    console.error("Pairing error:", err);
    return res.status(503).json({ error: err.message });
  }
});

export default router;

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

// utils
async function removeDir(dir) {
  if (await fs.pathExists(dir)) await fs.remove(dir);
}

function formatNumber(num) {
  const phone = pn("+" + num.replace(/\D/g, ""));
  if (!phone.isValid()) throw new Error("Numéro invalide");
  return phone.getNumber("e164").replace("+", "");
}

async function loadCommands() {
  const map = new Map();
  const files = fs.readdirSync("./commands").filter(f => f.endsWith(".js"));
  for (const f of files) {
    const cmd = await import(`./commands/${f}`);
    map.set(cmd.name, cmd);
  }
  return map;
}

// session pairing
async function startPairingSession(number) {
  const dir = path.join(PAIRING_DIR, number);
  await fs.ensureDir(dir);

  // config auto
  const configPath = path.join(dir, "config.json");
  const allowedPath = path.join(dir, "allowed.json");

  if (!(await fs.pathExists(configPath))) {
    await fs.writeJSON(configPath, {
      owner: number,
      public: true,
      prefix: "!"
    }, { spaces: 2 });
  }

  if (!(await fs.pathExists(allowedPath))) {
    await fs.writeJSON(allowedPath, [number], { spaces: 2 });
  }

  const config = await fs.readJSON(configPath);
  const allowed = new Set(await fs.readJSON(allowedPath));

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    browser: Browsers.windows("RAIZEL-XMD"),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
    },
    markOnlineOnConnect: false
  });

  sock.ev.on("creds.update", saveCreds);

  const commands = await loadCommands();

  // messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const mek = messages[0];
    if (!mek?.message) return;

    if (mek.key.id?.startsWith("SH3NN-")) return;

    const jid = mek.key.participant || mek.key.remoteJid;
    const sender = jid.split("@")[0];

    // SELF MODE
    if (!config.public && sender !== config.owner && !mek.key.fromMe) return;

    // allowed
    if (!allowed.has(sender) && sender !== config.owner) return;

    const text =
      mek.message.conversation ||
      mek.message.extendedTextMessage?.text ||
      mek.message.imageMessage?.caption ||
      mek.message.videoMessage?.caption ||
      "";

    if (!text.startsWith(config.prefix)) return;

    const args = text.slice(1).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    if (commands.has(cmd)) {
      await commands.get(cmd).execute(sock, mek, args, {
        config,
        allowed,
        saveConfig: () => fs.writeJSON(configPath, config, { spaces: 2 }),
        saveAllowed: () => fs.writeJSON(allowedPath, [...allowed], { spaces: 2 })
      });
    }
  });

  // connection
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      const code = qr.match(/.{1,4}/g)?.join("-");
      await fs.writeJSON(path.join(dir, "pairing.json"), { code });
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        await removeDir(dir);
      } else {
        setTimeout(() => startPairingSession(number), 2000);
      }
    }
  });

  if (!sock.authState.creds.registered) {
    await delay(1500);
    const code = await sock.requestPairingCode(number);
    return code.match(/.{1,4}/g)?.join("-");
  }

  return null;
}

// route
router.get("/", async (req, res) => {
  try {
    const number = formatNumber(req.query.number);
    const code = await startPairingSession(number);
    return res.json(code ? { code } : { status: "Déjà connecté" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;

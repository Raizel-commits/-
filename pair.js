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
const BASE_DIR = "./lib2/pairing";

/* ---------- Utils ---------- */
async function rm(dir) {
  if (await fs.pathExists(dir)) await fs.remove(dir);
}

function formatNumber(num) {
  const p = pn("+" + num.replace(/\D/g, ""));
  if (!p.isValid()) throw new Error("Numéro WhatsApp invalide");
  return p.getNumber("e164").replace("+", "");
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

/* ---------- Session ---------- */
async function startPairing(number) {
  const dir = path.join(BASE_DIR, number);
  await fs.ensureDir(dir);

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
    browser: Browsers.windows("RAIZEL-XMD"),
    logger: pino({ level: "silent" }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
    },
    markOnlineOnConnect: false
  });

  sock.ev.on("creds.update", saveCreds);

  const commands = await loadCommands();

  /* ---------- Messages ---------- */
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const m = messages[0];
    if (!m?.message) return;

    if (m.key.id?.startsWith("SH3NN-")) return;

    const jid = m.key.participant || m.key.remoteJid;
    const sender = jid.split("@")[0];

    if (!config.public && sender !== config.owner && !m.key.fromMe) return;
    if (!allowed.has(sender) && sender !== config.owner) return;

    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      m.message.imageMessage?.caption ||
      m.message.videoMessage?.caption ||
      "";

    if (!text.startsWith(config.prefix)) return;

    const args = text.slice(1).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    if (commands.has(cmd)) {
      await commands.get(cmd).execute(sock, m, args, {
        config,
        allowed,
        saveConfig: () =>
          fs.writeJSON(configPath, config, { spaces: 2 }),
        saveAllowed: () =>
          fs.writeJSON(allowedPath, [...allowed], { spaces: 2 })
      });
    }
  });

  /* ---------- Connexion ---------- */
  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        await rm(dir);
      } else {
        setTimeout(() => startPairing(number), 2000);
      }
    }
  });

  if (!sock.authState.creds.registered) {
    await delay(1500);
    const code = await sock.requestPairingCode(number);
    return code.match(/.{1,4}/g).join("-");
  }

  return null;
}

/* ---------- Route ---------- */
router.get("/", async (req, res) => {
  try {
    const number = formatNumber(req.query.number);
    const code = await startPairing(number);
    res.json(code ? { code } : { status: "already_connected" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

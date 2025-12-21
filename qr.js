import express from "express";
import fs from "fs-extra";
import QRCode from "qrcode";
import pino from "pino";
import path from "path";
import {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
  DisconnectReason
} from "@whiskeysockets/baileys";

const router = express.Router();
const QR_DIR = "./lib2/qr";

router.get("/", async (req, res) => {
  const sessionId = Date.now().toString(36);
  const dir = path.join(QR_DIR, sessionId);
  await fs.ensureDir(dir);

  try {
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

    sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
      if (qr) {
        const img = await QRCode.toDataURL(qr);
        return res.json({ qr: img });
      }

      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          await fs.remove(dir);
        }
      }
    });

  } catch (e) {
    await fs.remove(dir);
    res.status(503).json({ error: "QR indisponible" });
  }
});

export default router;

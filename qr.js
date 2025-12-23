import express from "express";
import fs from "fs-extra";
import QRCode from "qrcode";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import { startBot } from "./startBot.js";

const router = express.Router();

router.get("/", async (req, res) => {
    const sessionId = Date.now().toString(36);
    const dir = `./sessions/qr_${sessionId}`;
    await fs.ensureDir(dir);

    try {
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

        sock.ev.on("connection.update", async ({ connection, qr }) => {
            if (qr) {
                const qrImg = await QRCode.toDataURL(qr);
                return res.json({ qr: qrImg });
            }

            if (connection === "open") {
                console.log("✅ QR connecté :", sessionId);
                await startBot(dir, sessionId);
            }
        });

    } catch (e) {
        console.error(e);
        await fs.remove(dir);
        return res.status(503).json({ error: "Service indisponible" });
    }
});

export default router;

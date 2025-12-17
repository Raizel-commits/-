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
    delay,
    makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";

import { startBot } from "./startBot.js";

const router = express.Router();
const PAIRING_DIR = "./sessions";

function formatNumber(num) {
    const phone = pn("+" + num.replace(/\D/g, ""));
    if (!phone.isValid()) throw new Error("Numéro invalide");
    return phone.getNumber("e164").replace("+", "");
}

async function startPairing(number) {
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
        logger: pino({ level: "silent" }),
        browser: Browsers.windows("RAIZEL-XMD"),
        markOnlineOnConnect: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === "open") {
            console.log("✅ Pair connecté :", number);
            await startBot(dir, number);
        }

        if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === DisconnectReason.loggedOut) {
                await fs.remove(dir);
            }
        }
    });

    if (!sock.authState.creds.registered) {
        await delay(1500);
        const code = await sock.requestPairingCode(number);
        return code?.match(/.{1,4}/g)?.join("-") || code;
    }

    return null;
}

router.get("/", async (req, res) => {
    try {
        let number = req.query.number;
        if (!number) return res.status(400).json({ error: "Numéro requis" });

        number = formatNumber(number);
        const code = await startPairing(number);

        if (code) return res.json({ code });
        return res.json({ status: "Déjà connecté" });

    } catch (e) {
        console.error(e);
        exec("pm2 restart qasim");
        return res.status(503).json({ error: e.message });
    }
});

export default router;

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

/* ---------- Session ---------- */
async function startPairing(number) {
    const dir = path.join(BASE_DIR, number);
    await fs.ensureDir(dir);

    const configPath = path.join(dir, "config.json");
    const allowedPath = path.join(dir, "allowed.json");

    // Création config si inexistante
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

        // Ignore certains IDs spéciaux
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

        const args = text.slice(config.prefix.length).trim().split(/ +/);
        const cmdName = args.shift().toLowerCase();

        if (commands.has(cmdName)) {
            try {
                await commands.get(cmdName).execute(sock, m, args, {
                    config,
                    allowed,
                    saveConfig: () => fs.writeJSON(configPath, config, { spaces: 2 }),
                    saveAllowed: () => fs.writeJSON(allowedPath, [...allowed], { spaces: 2 })
                });
            } catch (err) {
                console.error("Erreur commande:", err);
            }
        }
    });

    /* ---------- Connexion ---------- */
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            const code = qr?.match(/.{1,4}/g)?.join("-");
            await fs.writeJSON(path.join(dir, "pairing.json"), { code }, { spaces: 2 });
        }

        if (connection === "close") {
            const status = lastDisconnect?.error?.output?.statusCode;
            if (status === DisconnectReason.loggedOut) {
                await rm(dir);
            } else {
                console.log("Redémarrage session...", number);
                setTimeout(() => startPairing(number), 2000);
            }
        }
    });

    // Génération pairing si pas encore enregistré
    if (!sock.authState.creds.registered) {
        await delay(1500);
        try {
            const pairingCode = await sock.requestPairingCode(number);
            const formatted = pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode;
            await fs.writeJSON(path.join(dir, "pairing.json"), { code: formatted }, { spaces: 2 });
            return formatted;
        } catch (err) {
            await rm(dir);
            throw new Error("Impossible de générer le pairing code: " + err.message);
        }
    }

    return null; // Déjà connecté
}

/* ---------- Route ---------- */
router.get("/", async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Numéro requis" });

    try {
        num = formatNumber(num);

        const sessionDir = path.join(BASE_DIR, num);
        if (await fs.pathExists(sessionDir)) {
            return res.status(403).json({ error: "Ce numéro a déjà un bot actif" });
        }

        const code = await startPairing(num);
        if (code) return res.json({ code });
        else return res.json({ status: "Déjà connecté" });

    } catch (err) {
        console.error("Pairing error:", err);
        exec("pm2 restart qasim"); // auto-restart
        return res.status(503).json({ error: err.message });
    }
});

export default router;

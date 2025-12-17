import express from "express";
import fs from "fs-extra";
import path from "path";
import pino from "pino";
import pn from "awesome-phonenumber";
import chalk from "chalk";
import { exec } from "child_process";
import {
    makeWASocket,
    useMultiFileAuthState,
    Browsers,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    delay
} from "@whiskeysockets/baileys";

// ===== Import Baileys version JSON =====
const baileysVersionPath = path.resolve('./baileys-version.json');
const defaultVersion = JSON.parse(fs.readFileSync(baileysVersionPath, 'utf-8'));

// ===== Globals =====
global.sessions = global.sessions || {};
global.config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config.json"), "utf-8"));

const router = express.Router();
const PAIRING_DIR = "./lib2/pairing";

// ===== Helpers =====
function getBareNumber(input) {
    if (!input) return "";
    return String(input).split("@")[0].replace(/[^0-9]/g, "");
}

function normalizeLid(jid) {
    if (!jid) return null;
    return jid.split(":")[0];
}

function getMessageText(msg) {
    return (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        ""
    );
}

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

// ===== Start Pairing Session =====
async function startPairingSession(xeonNumber) {
    const dir = path.join(PAIRING_DIR, xeonNumber);
    await fs.ensureDir(dir);

    const { state, saveCreds } = await useMultiFileAuthState(dir);

    const sock = makeWASocket({
        version: defaultVersion,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers.windows("Chrome"),
        markOnlineOnConnect: false
    });

    sock.commands = await loadCommands();
    sock.ev.on("creds.update", saveCreds);

    global.sessions[xeonNumber] = global.sessions[xeonNumber] || {
        sock: null,
        firstRestartDone: false,
        restarting: false,
        owners: []
    };
    global.sessions[xeonNumber].sock = sock;

    const session = global.sessions[xeonNumber];

    // ===== Messages Listener =====
    sock.ev.on("messages.upsert", async ({ messages }) => {
        try {
            const mainOwners = global.config.MAIN_OWNERS || [];

            for (const m of messages) {
                if (!m?.message) continue;

                const realSenderJid = m.key.fromMe ? sock.user.id : (m.key.participant || m.key.remoteJid);
                const senderId = getBareNumber(realSenderJid);

                const isMainOwner = mainOwners.some(owner =>
                    senderId === owner.number || (m.key.participant && getBareNumber(m.key.participant) === owner.lid)
                );

                const isOwner = sock.sessionOwners?.includes(senderId) || isMainOwner;
                const body = getMessageText(m);

                if (!body.startsWith(global.config.PREFIXE_COMMANDE)) continue;

                const args = body.slice(global.config.PREFIXE_COMMANDE.length).trim().split(/ +/);
                const cmdName = args.shift().toLowerCase();

                if (!sock.commands.has(cmdName)) continue;

                try {
                    await sock.commands.get(cmdName).execute(sock, m, args, sock.commands);
                } catch (err) {
                    console.error(`❌ Erreur commande ${cmdName}:`, err);
                }
            }

            // ===== Redémarrage interne automatique au premier démarrage =====
            if (!session.firstRestartDone) {
                session.firstRestartDone = true;
                setTimeout(async () => {
                    try {
                        if (session?.sock?.ev) session.sock.ev.removeAllListeners();
                        if (session?.sock?.ws) await session.sock.ws.close();
                        await startPairingSession(xeonNumber);
                        console.log(`♻ Redémarrage interne terminé pour ${xeonNumber}`);
                    } catch (err) {
                        console.error(`❌ Erreur redémarrage interne ${xeonNumber}:`, err);
                    }
                }, 2000);
            }

        } catch (err) {
            console.error("Erreur messages.upsert:", err);
        }
    });

    // ===== Connection Update =====
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        const pairingPath = path.join(dir, "pairing.json");

        if (qr) {
            const formatted = qr.match(/.{1,4}/g)?.join("-") || qr;
            await fs.writeJSON(pairingPath, { code: formatted }, { spaces: 2 });
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.message;
            console.log(chalk.red(`❌ Déconnecté: ${xeonNumber} (${reason})`));

            if (reason !== DisconnectReason.loggedOut && !session.restarting) {
                session.restarting = true;
                try {
                    await startPairingSession(xeonNumber);
                } catch (err) {
                    console.error(`❌ Erreur reconnect ${xeonNumber}:`, err);
                } finally {
                    session.restarting = false;
                }
            } else {
                try { await fs.remove(pairingPath); } catch (e) {}
            }
        }

        if (connection === "open") {
            console.log(chalk.green(`✔ Connecté: ${xeonNumber}`));
            const ownerId = getBareNumber(sock.user?.id || xeonNumber);
            const ownerLid = sock.user?.lid ? normalizeLid(sock.user.lid) : null;
            sock.sessionOwners = [ownerId, ownerLid].filter(Boolean);
            session.owners = sock.sessionOwners;
        }
    });

    // ===== Gestion pairing si pas enregistré =====
    if (!sock.authState.creds.registered) {
        await delay(1500);
        try {
            const pairingCode = await sock.requestPairingCode(xeonNumber);
            const formatted = pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode;
            await fs.writeJSON(path.join(dir, "pairing.json"), { code: formatted }, { spaces: 2 });
        } catch (err) {
            await removeFile(dir);
            throw new Error("Impossible de générer le pairing code: " + err.message);
        }
    }

    return null;
}

// ===== Express Route =====
router.get("/", async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Numéro requis" });

    try {
        num = formatNumber(num);
        await startPairingSession(num);
        return res.json({ status: "Session démarrée", number: num });
    } catch (err) {
        console.error("Pairing error:", err);
        exec("pm2 restart qasim");
        return res.status(503).json({ error: err.message });
    }
});

export default router;

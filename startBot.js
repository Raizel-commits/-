import {
    makeWASocket,
    useMultiFileAuthState,
    Browsers,
    fetchLatestBaileysVersion,
    DisconnectReason
} from "@whiskeysockets/baileys";

import pino from "pino";

/**
 * Map des bots actifs
 * key   = identifiant (numéro ou sessionId)
 * value = sock
 */
export const bots = new Map();

export async function startBot(sessionDir, botId) {
    // Évite double lancement
    if (bots.has(botId)) return;

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        browser: Browsers.windows("RAIZEL-XMD"),
        markOnlineOnConnect: false
    });

    bots.set(botId, sock);

    sock.ev.on("creds.update", saveCreds);

    // ================= COMMANDES =================
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg || !msg.message) return;

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

        const prefix = ".";
        if (!text.startsWith(prefix)) return;

        const from = msg.key.remoteJid;
        const command = text.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase();

        console.log(`[BOT ${botId}] CMD =>`, command);

        try {
            switch (command) {
                case "menu":
                    await sock.sendMessage(from, {
                        text: `🤖 *RAIZEL-XMD*
                        
.menu  – Afficher le menu
.ping  – Test bot
.owner – Infos`
                    });
                    break;

                case "ping":
                    await sock.sendMessage(from, { text: "🏓 Pong !" });
                    break;

                case "owner":
                    await sock.sendMessage(from, { text: "👑 RAIZEL XMD" });
                    break;
            }
        } catch (err) {
            console.error("ERREUR CMD :", err);
        }
    });
    // =============================================

    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode;
            bots.delete(botId);

            if (code !== DisconnectReason.loggedOut) {
                console.log("♻️ Reconnexion bot :", botId);
                startBot(sessionDir, botId);
            }
        }

        if (connection === "open") {
            console.log("✅ BOT PRÊT :", botId);
        }
    });
}

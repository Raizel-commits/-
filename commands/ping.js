// commands/ping.js
export const name = "ping";                // Nom de la commande
export const description = "Répond Pong";  // Description (optionnelle)

export async function execute(sock, msg, args) {
    const jid = msg.key.remoteJid;        // ID du chat où envoyer la réponse
    await sock.sendMessage(jid, { text: "Pong 🏓" });
}

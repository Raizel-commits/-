export const name = "ping";
export const ownerOnly = false; // tout le monde peut utiliser

export async function execute(sock, msg, args, commands) {
    await sock.sendMessage(msg.key.remoteJid, { text: "🏓 Pong !" });
}

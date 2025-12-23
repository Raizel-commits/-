export const name = "ping";

export async function execute(sock, msg, args) {
    const from = msg.key.remoteJid;
    await sock.sendMessage(from, { text: "Pong!" });
}

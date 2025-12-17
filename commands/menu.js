export const name = "menu";

export async function execute(sock, msg, args, commands) {
    let text = `👑 *BOT PRIVÉ*\n`;
    text += `Owner: vous\n\n`;

    for (const cmd of commands.keys()) {
        text += `• !${cmd}\n`;
    }

    await sock.sendMessage(msg.key.remoteJid, { text });
}

export const name = "menu";
export const ownerOnly = true;

export async function execute(sock, msg, args, commands) {
    const from = msg.key.remoteJid;

    let text = "📜 *Liste des commandes :*\n\n";
    for (const [cmdName, cmd] of commands) {
        text += `• ${cmdName}${cmd.ownerOnly ? " (Owner)" : ""}\n`;
    }

    await sock.sendMessage(from, { text });
}

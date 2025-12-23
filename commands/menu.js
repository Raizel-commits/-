export const name = "menu";
export const ownerOnly = true;

export async function execute(sock, msg, args, commands) {
    const list = Array.from(commands.keys()).join("\n- ");
    const text = `📜 Liste des commandes disponibles :\n- ${list}`;
    await sock.sendMessage(msg.key.remoteJid, { text });
}

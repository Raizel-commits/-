export const name = "ginfo";

export async function execute(ctx) {
    const { sock, from, isGroup, sender } = ctx;

    if (!isGroup) {
        await sock.sendMessage(from, { text: "❌ Cette commande fonctionne uniquement dans un groupe." });
        return;
    }

    const metadata = await sock.groupMetadata(from);
    const admins = metadata.participants.filter(p => p.admin).map(p => p.id).join("\n");

    const info = `📌 Info Groupe :
- Nom: ${metadata.subject}
- ID: ${metadata.id}
- Admins:\n${admins}`;

    await sock.sendMessage(from, { text: info });
}

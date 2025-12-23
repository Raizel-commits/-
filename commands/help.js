export const name = "help";

export async function execute(ctx) {
    if (!ctx.isOwner) {
        return; // silencieux (bot privé)
        // ou si tu préfères un message :
        // return ctx.sock.sendMessage(ctx.from, { text: "❌ Accès refusé" });
    }

    let text = "📖 *Commandes disponibles (Privé)*\n\n";

    for (const [name] of ctx.commands) {
        text += `• !${name}\n`;
    }

    await ctx.sock.sendMessage(ctx.from, { text });
}

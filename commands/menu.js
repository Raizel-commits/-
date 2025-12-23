export const name = "menu";

export async function execute(ctx) {
    if (!ctx.isOwner) {
        return ctx.sock.sendMessage(ctx.from, {
            text: "❌ Commande réservée au propriétaire"
        });
    }

    await ctx.sock.sendMessage(ctx.from, {
        text: "👑 Menu propriétaire\n\n• !restart\n• !status"
    });
}

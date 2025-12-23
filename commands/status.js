export const name = "status";

export async function execute(ctx) {
    const { sock, sender } = ctx;
    const status = "✅ Bot en ligne et fonctionnel";
    await sock.sendMessage(sender, { text: status });
}

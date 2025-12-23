export const name = "ping";

export async function execute(ctx) {
    const { sock, from } = ctx;
    await sock.sendMessage(from, { text: "🏓 Pong !" });
}

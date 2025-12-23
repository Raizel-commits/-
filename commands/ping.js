export const name = "ping";

export async function execute(ctx) {
    const { sock, from } = ctx;

    // Répond avec "Pong!" dans le même chat
    await sock.sendMessage(from, { text: "Pong!" });
}

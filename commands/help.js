export const name = "help";

export async function execute(ctx) {
    const { sock, from, commands } = ctx;

    let helpMessage = "📜 Liste des commandes disponibles :\n\n";
    commands.forEach((cmd, key) => {
        helpMessage += `• !${key}\n`;
    });

    // Toujours répondre dans le chat où la commande est tapée
    await sock.sendMessage(from, { text: helpMessage });
}

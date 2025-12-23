export const name = "restart";
export const ownerOnly = true; // uniquement le propriétaire peut redémarrer

export async function execute(sock, msg, args, commands) {
    const from = msg.key.remoteJid;
    await sock.sendMessage(from, { text: "🔄 Redémarrage de cette session en cours..." });

    // On ferme juste cette socket pour redémarrer la session via pair.js
    try {
        sock.ev.removeAllListeners(); // enlever tous les listeners
        sock.ws.close(); // fermer la connexion
        process.nextTick(() => process.exit(0)); // exit pour que PM2 ou ton gestionnaire relance
    } catch (err) {
        console.error("Erreur lors du restart :", err);
    }
}

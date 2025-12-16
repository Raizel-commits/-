export default {
    name: 'ping',           // Commande : !ping
    description: 'Répond pong',
    execute: async (sock, msg, args) => {
        try {
            // Envoi "Pong !" au chat d'où vient le message
            await sock.sendMessage(msg.key.remoteJid, { text: 'Pong ! 🏓' });
        } catch (err) {
            console.error('Erreur ping command:', err);
        }
    }
};

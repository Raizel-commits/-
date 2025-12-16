export default {
    name: 'hello',
    description: 'Répond Bonjour',
    async execute(sock, msg, args) {
        const jid = msg.key.remoteJid;
        const name = msg.pushName || 'ami';
        await sock.sendMessage(jid, { text: `Bonjour ${name} ! 👋` });
    }
};

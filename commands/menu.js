export default {
    name: 'menu',
    description: 'Affiche le menu des commandes disponibles',
    execute: async (sock, msg, args) => {
        try {
            const menuText = `
📜 *RAIZEL XMD - Menu des commandes*

1️⃣ !ping - Vérifie si le bot répond
2️⃣ !hello - Salutation du bot
3️⃣ !menu - Affiche ce menu
4️⃣ !info - Infos sur le bot

💡 Pour utiliser une commande, tape-la avec le préfixe !
Exemple : !ping
            `;

            await sock.sendMessage(msg.key.remoteJid, { 
                text: menuText, 
                // Pour WhatsApp Markdown
                // 'text' accepte déjà les *gras* et _italique_  
            });
        } catch (err) {
            console.error('Erreur menu command:', err);
        }
    }
};

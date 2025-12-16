import fs from 'fs';
import path from 'path';

export default {
    name: 'menu',
    description: 'Affiche le menu des commandes',
    execute: async (sock, msg, args) => {
        const commandFiles = fs.readdirSync(path.join('./commands')).filter(f => f.endsWith('.js'));
        const cmds = commandFiles.map(f => f.replace('.js', '')).join('\n');

        const menuText = `
📜 *RAIZEL XMD - Menu des commandes*

${cmds.split('\n').map((c,i)=>`${i+1}️⃣ !${c}`).join('\n')}

💡 Pour utiliser une commande, tape-la avec le préfixe !
Exemple : !ping
        `;
        await sock.sendMessage(msg.key.remoteJid, { text: menuText });
    }
};

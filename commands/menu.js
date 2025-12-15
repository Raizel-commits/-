export default {
    name: 'menu',
    execute: async (sock, msg) => {
        await sock.sendMessage(msg.key.remoteJid, {
            text: `📜 *RAIZEL XMD MENU*
!ping
!menu
!help`
        })
    }
}

export const name = "self";

export async function execute(sock, mek, args, { config }) {
  if (mek.key.fromMe === false) {
    return sock.sendMessage(mek.key.remoteJid, {
      text: "❌ Owner uniquement"
    }, { quoted: mek });
  }

  config.public = false;

  await sock.sendMessage(mek.key.remoteJid, {
    text: "🔐 Mode SELF activé"
  }, { quoted: mek });
}

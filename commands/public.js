export const name = "public";

export async function execute(sock, mek, args, { config }) {
  config.public = true;

  await sock.sendMessage(mek.key.remoteJid, {
    text: "🌍 Mode PUBLIC activé"
  }, { quoted: mek });
}

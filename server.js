import express from 'express'
import cors from 'cors'
import { Boom } from '@hapi/boom'
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import pino from 'pino'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'

/* ======================
   ESM __dirname
====================== */
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/* ======================
   EXPRESS
====================== */
const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname)))

/* ======================
   STOCKAGE
====================== */
const sessions = new Map()
const commands = new Map()
const qrCache = new Map()

/* ======================
   COMMANDES
====================== */
async function loadCommands() {
  const cmdPath = path.join(__dirname, 'commands')
  if (!await fs.pathExists(cmdPath)) return

  const files = await fs.readdir(cmdPath)
  for (const file of files) {
    if (!file.endsWith('.js')) continue
    const { default: cmd } = await import(`./commands/${file}`)
    commands.set(cmd.name.toLowerCase(), cmd)
    console.log('✅ Commande chargée:', cmd.name)
  }
}

/* ======================
   CONNEXION WHATSAPP
====================== */
async function createConnection(username, phone) {
  if (sessions.has(username)) return sessions.get(username)

  const sessionDir = path.join(__dirname, 'sessions', username)
  await fs.ensureDir(sessionDir)

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['RAIZEL-XMD', 'Chrome', '6.7.5']
  })

  sessions.set(username, sock)
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u

    if (qr) qrCache.set(username, qr)

    if (connection === 'open') {
      console.log(`✅ ${username} connecté`)
      qrCache.delete(username)
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output.statusCode
        : 0

      sessions.delete(username)
      qrCache.delete(username)

      if (code !== DisconnectReason.loggedOut) {
        console.log(`🔄 Reconnexion ${username}`)
        setTimeout(() => createConnection(username, phone), 2000)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages?.[0]
    if (!msg?.message || msg.key.fromMe) return

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text

    if (!text || !text.startsWith('!')) return

    const [name, ...args] = text.slice(1).split(' ')
    const cmd = commands.get(name.toLowerCase())
    if (!cmd) return

    try {
      await cmd.execute(sock, msg, args)
    } catch (e) {
      console.error('❌ CMD ERROR', e)
    }
  })

  return sock
}

/* ======================
   ROUTES
====================== */

/* 🔍 test */
app.get('/ping', (_, res) => {
  res.json({ ok: true })
})

/* 📸 QR */
app.post('/qr', async (req, res) => {
  const { phone, username } = req.body
  if (!phone || !username)
    return res.json({ error: 'Paramètres manquants' })

  await createConnection(username, phone)

  let tries = 0
  const interval = setInterval(() => {
    tries++
    const qr = qrCache.get(username)

    if (qr) {
      clearInterval(interval)
      return res.json({ qr })
    }

    if (tries > 30) {
      clearInterval(interval)
      return res.json({ status: 'Timeout QR' })
    }
  }, 1000)
})

/* 🔑 PAIRING */
app.post('/pairing', async (req, res) => {
  const { phone, username } = req.body
  if (!phone || !username)
    return res.json({ error: 'Paramètres manquants' })

  const sock = await createConnection(username, phone)

  if (sock.authState?.creds?.registered) {
    return res.json({ status: 'Déjà connecté' })
  }

  try {
    const code = await sock.requestPairingCode(phone)
    res.json({ code })
  } catch (e) {
    console.error(e)
    res.json({ error: 'Erreur pairing' })
  }
})

/* ======================
   START
====================== */
await loadCommands()

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🔥 RAIZEL-XMD backend actif sur ${PORT}`)
})

/* ======================
   SAFE ERRORS
====================== */
process.on('uncaughtException', e => console.error(e))
process.on('unhandledRejection', e => console.error(e))

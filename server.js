import express from 'express'
import { Boom } from '@hapi/boom'
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import pino from 'pino'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'

/* 🔧 __dirname ESM */
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/* 🌐 Express */
const app = express()
app.use(express.json())
app.use(express.static(__dirname))

/* 🧠 Sessions + commandes */
const sessions = new Map()
const commands = new Map()
const qrCache = new Map()

/* ⚙️ Charger les commandes */
async function loadCommands() {
    const cmdPath = path.join(__dirname, 'commands')
    const files = await fs.readdir(cmdPath)

    for (const file of files) {
        if (!file.endsWith('.js')) continue

        const { default: command } = await import(`./commands/${file}`)

        commands.set(command.name, command)
        console.log(`✅ Commande chargée : ${command.name}`)
    }
}

/* 🤖 Créer une connexion WhatsApp */
async function createConnection(username, phone) {
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

    /* 🔗 Connexion */
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) qrCache.set(username, qr)

        if (connection === 'open') {
            console.log(`✅ ${username} connecté`)
            qrCache.delete(username)
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error instanceof Boom
                ? lastDisconnect.error.output.statusCode
                : 0

            if (code !== DisconnectReason.loggedOut) {
                console.log(`🔄 Reconnexion ${username}`)
                createConnection(username, phone)
            } else {
                sessions.delete(username)
            }
        }
    })

    /* 📩 Messages → commandes */
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]
        if (!msg?.message || msg.key.fromMe) return

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text

        if (!text || !text.startsWith('!')) return

        const [cmdName, ...args] = text.slice(1).split(' ')
        const cmd = commands.get(cmdName.toLowerCase())
        if (!cmd) return

        try {
            await cmd.execute(sock, msg, args)
        } catch (e) {
            console.error(e)
        }
    })

    return sock
}

/* 📸 QR */
app.post('/qr', async (req, res) => {
    const { phone, username } = req.body
    if (!phone || !username) return res.json({ error: 'Paramètres manquants' })

    if (!sessions.get(username)) {
        await createConnection(username, phone)
    }

    let tries = 0
    const wait = setInterval(() => {
        const qr = qrCache.get(username)
        tries++

        if (qr) {
            clearInterval(wait)
            return res.json({ qr, status: 'Scan requis' })
        }

        if (tries >= 30) {
            clearInterval(wait)
            return res.json({ qr: null, status: 'Timeout' })
        }
    }, 1000)
})

/* 🔢 Pairing code */
app.post('/pairing', async (req, res) => {
    const { phone, username } = req.body
    if (!phone || !username) return res.json({ error: 'Paramètres manquants' })

    let sock = sessions.get(username)
    if (!sock) sock = await createConnection(username, phone)

    if (sock.authState.creds.registered) {
        return res.json({ status: 'Déjà connecté' })
    }

    const code = await sock.requestPairingCode(phone)
    res.json({ code })
})

/* 🚀 START */
await loadCommands()

const PORT = process.env.PORT || 3000
app.listen(PORT, () =>
    console.log(`🔥 RAIZEL XMD lancé sur le port ${PORT}`)
)

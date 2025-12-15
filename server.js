const express = require('express');
const { Boom } = require('@hapi/boom');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // Sert index.html à la racine

const sessions = new Map(); // Stocke les sockets par username

async function createConnection(username, phone) {
    const sessionDir = path.join(__dirname, 'sessions', username);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            // QR généré → envoie via API si demandé
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) createConnection(username, phone);
        } else if (connection === 'open') {
            console.log(`Bot ${username} connecté sur ${phone}`);
        }
    });

    sessions.set(username, sock);
    return sock;
}

// Endpoint QR Code
app.post('/qr', async (req, res) => {
    const { phone, username } = req.body;
    if (!phone || !username) return res.json({ error: 'Paramètres manquants' });

    let sock = sessions.get(username);
    if (!sock) sock = await createConnection(username, phone);

    // Attendre le QR (Baileys l'émet via l'event)
    const qrPromise = new Promise((resolve) => {
        sock.ev.once('connection.update', (update) => {
            if (update.qr) resolve(`data:image/png;base64,${update.qr}`);
            if (update.connection === 'open') resolve(null);
        });
    });

    const qr = await Promise.race([qrPromise, new Promise(resolve => setTimeout(() => resolve('timeout'), 30000))]);

    const status = sock.user ? 'Connecté' : 'En attente de scan';
    res.json({ qr, status: status || 'Généré, scannez rapidement !' });
});

// Endpoint Pairing Code
app.post('/pairing', async (req, res) => {
    const { phone, username } = req.body;
    if (!phone || !username) return res.json({ error: 'Paramètres manquants' });

    let sock = sessions.get(username);
    if (!sock) sock = await createConnection(username, phone);

    try {
        const code = await sock.requestPairingCode(phone);
        res.json({ code, status: 'Code généré, entrez-le dans WhatsApp' });
    } catch (err) {
        res.json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur RAIZEL XMD démarré sur port ${PORT}`));
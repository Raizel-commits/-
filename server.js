import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import cors from 'cors';

import pairRouter from './pair.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Routes API
app.use('/code', pairRouter);

// Pages HTML
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/pair', (req, res) => res.sendFile(path.join(__dirname, 'pair.html')));

// Démarrage serveur
app.listen(PORT, () => {
  console.log(`🚀 RAIZEL-XMD actif sur http://localhost:${PORT}`);
});

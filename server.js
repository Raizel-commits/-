import express from "express";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import CryptoJS from "crypto-js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔑 MongoDB intégré directement
const MONGO_URI = "mongodb+srv://minetrol:jarix55%40@cluster0.kxdu8z9.mongodb.net/minetrol?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI);
mongoose.connection.on("connected", () => console.log("✅ MongoDB connecté"));
mongoose.connection.on("error", err => console.log("❌ MongoDB Error:", err));

const app = express();

// 🌐 Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 60_000, max: 10 }));
app.use(express.static(__dirname)); // sert tous les fichiers à la racine

// 📦 Modèles
const User = mongoose.model("User", {
  username: { type: String, unique: true },
  inboxToken: String,
  createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model("Message", {
  toUserId: mongoose.Types.ObjectId,
  content: String,
  ipHash: String,
  createdAt: { type: Date, default: Date.now }
});

// 🌐 Pages HTML
app.get("/", (_, res) => res.sendFile("index.html", { root: __dirname }));
app.get("/u/:username", (_, res) => res.sendFile("send.html", { root: __dirname }));
app.get("/inbox", (_, res) => res.sendFile("inbox.html", { root: __dirname }));

// 🔐 API Routes
app.post("/api/create", async (req, res) => {
  try {
    const username = req.body.username.trim();
    if (!username) return res.status(400).json({ error: "Nom d'utilisateur requis" });

    const user = await User.create({
      username: username,
      inboxToken: CryptoJS.SHA256(username + Date.now()).toString()
    });
    res.json(user);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "Nom d'utilisateur déjà pris" });
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/send/:username", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

  const message = req.body.message.trim();
  if (!message) return res.status(400).json({ error: "Message vide" });

  await Message.create({
    toUserId: user._id,
    content: message,
    ipHash: CryptoJS.SHA256(req.ip).toString()
  });

  res.json({ success: true });
});

app.get("/api/inbox/:token", async (req, res) => {
  const user = await User.findOne({ inboxToken: req.params.token });
  if (!user) return res.status(401).json({ error: "Token invalide" });

  const msgs = await Message.find({ toUserId: user._id }).sort({ createdAt: -1 });
  res.json(msgs);
});

// 🚀 Lancement serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Secret Story lancé sur http://localhost:${PORT}`));
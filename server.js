import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const JWT_SECRET = "SECRET_STORY_KEY"; // tu peux mettre autre chose

// 🔑 Connexion MongoDB
mongoose.connect("mongodb+srv://minetrol:jarix55%40@cluster0.kxdu8z9.mongodb.net/minetrol");
mongoose.connection.once("open", () => console.log("✅ MongoDB connecté"));

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// 📦 Modèles
const User = mongoose.model("User", {
  email: { type: String, unique: true },
  password: String,
  username: { type: String, unique: true }
});

const Message = mongoose.model("Message", {
  to: String,
  content: String,
  createdAt: { type: Date, default: Date.now }
});

// 🌐 Pages HTML
app.get("/", (_, res) => res.sendFile("index.html", { root: __dirname }));
app.get("/dashboard", (_, res) => res.sendFile("dashboard.html", { root: __dirname }));
app.get("/u/:username", (_, res) => res.sendFile("send.html", { root: __dirname }));

// 🔐 API

// Register
app.post("/api/register", async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password || !username) return res.status(400).json({ error: "Champs manquants" });
  try {
    const hash = await bcrypt.hash(password, 10);
    await User.create({ email, password: hash, username });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "Email ou username déjà pris" });
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: "Email ou mot de passe incorrect" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Email ou mot de passe incorrect" });

  const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET);
  res.json({ token, username: user.username });
});

// Middleware auth
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Non autorisé" });
  try {
    req.user = jwt.verify(header, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token invalide" });
  }
}

// Inbox
app.get("/api/inbox", auth, async (req, res) => {
  const msgs = await Message.find({ to: req.user.username }).sort({ createdAt: -1 });
  res.json(msgs);
});

// Envoyer message anonyme
app.post("/api/send/:username", async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: "Message vide" });
  await Message.create({ to: req.params.username, content: message.trim() });
  res.json({ success: true });
});

// 🚀 Lancement serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Secret Story lancé sur http://localhost:${PORT}`));

import express from "express";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import CryptoJS from "crypto-js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔑 Connexion MongoDB directe
const MONGO_URI = "mongodb+srv://minetrol:jarix55%40@cluster0.kxdu8z9.mongodb.net/minetrol?retryWrites=true&w=majority";
mongoose.connect(MONGO_URI);
console.log("MongoDB connecté");

// 🌐 Express
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 60_000, max: 10 }));
app.use(express.static(__dirname));

// 📦 Models
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
app.get("/styles.css", (_, res) => res.sendFile("styles.css", { root: __dirname }));

// 🔐 API
app.post("/api/create", async (req, res) => {
  const user = await User.create({
    username: req.body.username,
    inboxToken: CryptoJS.SHA256(req.body.username + Date.now()).toString()
  });
  res.json(user);
});

app.post("/api/send/:username", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.sendStatus(404);

  await Message.create({
    toUserId: user._id,
    content: req.body.message,
    ipHash: CryptoJS.SHA256(req.ip).toString()
  });
  res.json({ success: true });
});

app.get("/api/inbox/:token", async (req, res) => {
  const user = await User.findOne({ inboxToken: req.params.token });
  if (!user) return res.sendStatus(401);

  const msgs = await Message.find({ toUserId: user._id });
  res.json(msgs);
});

// 🚀 Lancement
app.listen(3000, () => console.log("✅ Secret Story lancé sur http://localhost:3000"));

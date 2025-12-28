import express from "express";
import sqlite3 from "sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const JWT_SECRET = "SECRET_STORY_KEY";

app.use(express.json());
app.use(express.static(__dirname));

// --- SQLite ---
const db = new sqlite3.Database("./users.db", (err) => {
  if (err) console.error(err.message);
  else console.log("✅ SQLite connecté");
});

// Tables
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  password TEXT
)`);
db.run(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  toUser TEXT,
  content TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Pages
app.get("/", (_, res) => res.redirect("/login.html"));
app.get("/register.html", (_, res) => res.sendFile("register.html",{root:__dirname}));
app.get("/login.html", (_, res) => res.sendFile("login.html",{root:__dirname}));
app.get("/dashboard", (_, res) => res.sendFile("dashboard.html",{root:__dirname}));
app.get("/u/:username", (_, res) => res.sendFile("send.html",{root:__dirname}));

// --- API ---

// Register
app.post("/api/register", (req,res)=>{
  const {email,username,password} = req.body;
  if(!email||!username||!password) return res.status(400).json({error:"Champs manquants"});
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare("INSERT INTO users (email, username, password) VALUES (?, ?, ?)");
  stmt.run(email, username, hash, function(err){
    if(err){
      if(err.message.includes("UNIQUE")) return res.status(400).json({error:"Email ou username déjà pris"});
      return res.status(500).json({error:"Erreur serveur"});
    }
    res.json({success:true});
  });
  stmt.finalize();
});

// Login
app.post("/api/login", (req,res)=>{
  const {email,password} = req.body;
  if(!email||!password) return res.status(400).json({error:"Champs manquants"});
  db.get("SELECT * FROM users WHERE email = ?", [email], (err,user)=>{
    if(err) return res.status(500).json({error:"Erreur serveur"});
    if(!user) return res.status(401).json({error:"Email ou mot de passe incorrect"});
    const ok = bcrypt.compareSync(password,user.password);
    if(!ok) return res.status(401).json({error:"Email ou mot de passe incorrect"});
    const token = jwt.sign({id:user.id,username:user.username},JWT_SECRET);
    res.json({token,username:user.username});
  });
});

// Middleware auth
function auth(req,res,next){
  const header = req.headers.authorization;
  if(!header) return res.status(401).json({error:"Non autorisé"});
  try{ req.user = jwt.verify(header,JWT_SECRET); next(); } 
  catch{ res.status(401).json({error:"Token invalide"}); }
}

// Inbox
app.get("/api/inbox", auth, (req,res)=>{
  db.all("SELECT * FROM messages WHERE toUser = ? ORDER BY createdAt DESC", [req.user.username], (err,rows)=>{
    if(err) return res.status(500).json({error:"Erreur serveur"});
    res.json(rows);
  });
});

// Envoyer message anonyme
app.post("/api/send/:username", (req,res)=>{
  const {message} = req.body;
  if(!message||!message.trim()) return res.status(400).json({error:"Message vide"});
  const stmt = db.prepare("INSERT INTO messages (toUser, content) VALUES (?, ?)");
  stmt.run(req.params.username,message.trim(), function(err){
    if(err) return res.status(500).json({error:"Erreur serveur"});
    res.json({success:true});
  });
  stmt.finalize();
});

// Lancement serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Secret Story SQLite lancé sur http://localhost:${PORT}`));

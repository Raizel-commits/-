import express from "express";
import fs from "fs";
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

// --- JSON files ---
const USERS_FILE = path.join(__dirname, "users.json");
const MESSAGES_FILE = path.join(__dirname, "messages.json");

// Init files if not exist
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, "[]");

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// --- Pages ---
app.get("/", (_, res) => res.redirect("/login.html"));
app.get("/register.html", (_, res) => res.sendFile("register.html",{root:__dirname}));
app.get("/login.html", (_, res) => res.sendFile("login.html",{root:__dirname}));
app.get("/dashboard", (_, res) => res.sendFile("dashboard.html",{root:__dirname}));
app.get("/u/:username", (_, res) => res.sendFile("send.html",{root:__dirname}));

// --- API ---
// Register
app.post("/api/register", (req,res)=>{
  const {username,password} = req.body;
  if(!username||!password) return res.status(400).json({error:"Champs manquants"});
  const users = readJSON(USERS_FILE);
  if(users.find(u=>u.username===username)) return res.status(400).json({error:"Username déjà pris"});
  const hash = bcrypt.hashSync(password, 10);
  users.push({username,password:hash});
  writeJSON(USERS_FILE, users);
  res.json({success:true});
});

// Login
app.post("/api/login", (req,res)=>{
  const {username,password} = req.body;
  if(!username||!password) return res.status(400).json({error:"Champs manquants"});
  const users = readJSON(USERS_FILE);
  const user = users.find(u=>u.username===username);
  if(!user) return res.status(401).json({error:"Username ou mot de passe incorrect"});
  const ok = bcrypt.compareSync(password,user.password);
  if(!ok) return res.status(401).json({error:"Username ou mot de passe incorrect"});
  const token = jwt.sign({username:user.username},JWT_SECRET);
  res.json({token,username:user.username});
});

// Auth middleware
function auth(req,res,next){
  const header = req.headers.authorization;
  if(!header) return res.status(401).json({error:"Non autorisé"});
  try{ req.user = jwt.verify(header,JWT_SECRET); next(); } 
  catch{ res.status(401).json({error:"Token invalide"}); }
}

// Inbox
app.get("/api/inbox", auth, (req,res)=>{
  const messages = readJSON(MESSAGES_FILE).filter(m=>m.to===req.user.username);
  messages.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json(messages);
});

// Envoyer message anonyme
app.post("/api/send/:username", (req,res)=>{
  const {message} = req.body;
  if(!message||!message.trim()) return res.status(400).json({error:"Message vide"});
  const messages = readJSON(MESSAGES_FILE);
  messages.push({to:req.params.username, content:message.trim(), createdAt:new Date()});
  writeJSON(MESSAGES_FILE, messages);
  res.json({success:true});
});

// --- Lancement serveur ---
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Secret Story JSON lancé sur http://localhost:${PORT}`));

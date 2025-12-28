const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const { v4: uuid } = require("uuid");
const bcrypt = require("bcrypt");
const cors = require("cors");

const app = express();
app.use(bodyParser.json());
app.use(express.static(__dirname));
app.use(cors());

const USERS_FILE = "./users.json";
const loadUsers = () => {
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
  return JSON.parse(fs.readFileSync(USERS_FILE));
};
const saveUsers = (d) => fs.writeFileSync(USERS_FILE, JSON.stringify(d, null, 2));

// --- REGISTER
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  if (users.find(u => u.username === username))
    return res.json({ error: "Utilisateur existe" });

  const hashed = await bcrypt.hash(password, 10);
  users.push({
    id: uuid(),
    username,
    password: hashed,
    balance: 0,
    totalDeposit: 0
  });
  saveUsers(users);
  res.json({ success: true });
});

// --- LOGIN
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) return res.json({ error: "Identifiants invalides" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ error: "Identifiants invalides" });
  res.json(user);
});

// --- PLAY GAME
app.post("/api/play", (req, res) => {
  const { userId, bet, choice } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return res.json({ error: "Utilisateur non trouvé" });
  if (bet < 200 || bet > 666745 || bet > user.balance) return res.json({ error: "Mise invalide" });

  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  const sum = d1 + d2;

  let win = false;
  let multi = 0;
  if (choice === "plus" && sum > 7) win = true, multi = 2.3;
  if (choice === "moins" && sum < 7) win = true, multi = 2.3;
  if (choice === "egal" && sum === 7) win = true, multi = 5.8;

  user.balance += win ? bet * multi : -bet;
  saveUsers(users);
  res.json({ d1, d2, sum, win, balance: user.balance });
});

// --- MONEY FUSION DEPOSIT (simulation)
app.post("/api/moneyfusion/deposit", (req, res) => {
  const { userId, amount } = req.body;
  if (amount < 1000) return res.json({ error: "Montant minimum 1000 XAF" });
  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  user.balance += amount;
  user.totalDeposit += amount;
  saveUsers(users);
  res.json({ success: true });
});

// --- MONEY FUSION WITHDRAW (simulation)
app.post("/api/moneyfusion/withdraw", (req, res) => {
  const { userId, amount } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  if (user.balance < user.totalDeposit * 2) return res.json({ error: "Retrait autorisé après avoir doublé le dépôt total" });
  if (amount > user.balance) return res.json({ error: "Solde insuffisant" });
  user.balance -= amount;
  saveUsers(users);
  res.json({ success: true });
});

app.listen(3000, () => console.log("✅ Serveur lancé sur http://localhost:3000/login.html"));

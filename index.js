import express from "express";
import fs from "fs";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("."));

const USERS_FILE = "./users.json";
const MIN_BET = 50;

const readUsers = () =>
  JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));

const saveUsers = (users) =>
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

/* REGISTER */
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  const users = readUsers();

  if (users.find(u => u.username === username))
    return res.status(400).json({ error: "Utilisateur existe" });

  users.push({ username, password, balance: 1000 });
  saveUsers(users);

  res.json({ success: true });
});

/* LOGIN */
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user = readUsers().find(
    u => u.username === username && u.password === password
  );

  if (!user) return res.status(401).json({ error: "Erreur login" });
  res.json({ success: true, username });
});

/* BALANCE */
app.get("/api/balance/:user", (req, res) => {
  const user = readUsers().find(u => u.username === req.params.user);
  res.json({ balance: user.balance });
});

/* PLAY */
app.post("/api/play", (req, res) => {
  const { username, bet, choice } = req.body;
  const users = readUsers();
  const user = users.find(u => u.username === username);

  if (!user || bet < MIN_BET || bet > user.balance)
    return res.status(400).json({ error: "Mise invalide" });

  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const sum = d1 + d2;

  let win = false, mult = 0;
  if (choice === "plus" && sum > 7) { win = true; mult = 2.3; }
  if (choice === "egal" && sum === 7) { win = true; mult = 5.8; }
  if (choice === "moins" && sum < 7) { win = true; mult = 2.3; }

  if (win) user.balance += bet * mult;
  else user.balance -= bet;

  saveUsers(users);

  res.json({ d1, d2, sum, win, balance: user.balance });
});

app.listen(3000, () =>
  console.log("🎲 2Dé lancé : http://localhost:3000/login.html")
);

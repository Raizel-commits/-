import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";

const app = express();
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.resolve()));

const USERS_FILE = path.join(path.resolve(), "users.json");

// Lire utilisateurs
function readUsers() {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
}

// Sauvegarder utilisateurs
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

// Register
app.post("/register", (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();
    if (users.find(u => u.username === username)) return res.send("Utilisateur déjà existant.");
    users.push({ username, password, balance: 0 });
    saveUsers(users);
    res.redirect("/login.html");
});

// Login
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.send("Identifiant ou mot de passe incorrect.");
    res.redirect(`/game.html?user=${username}`);
});

// API: Obtenir solde
app.get("/api/balance/:username", (req, res) => {
    const users = readUsers();
    const user = users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });
    res.json({ balance: user.balance });
});

// API: Dépôt
app.post("/api/deposit", (req, res) => {
    const { username, amount } = req.body;
    const users = readUsers();
    const user = users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });
    if (parseInt(amount) < 1000) return res.status(400).json({ error: "Dépôt minimum 1000f" });
    user.balance += parseInt(amount);
    saveUsers(users);
    res.json({ balance: user.balance });
});

// API: Retrait
app.post("/api/withdraw", (req, res) => {
    const { username, amount } = req.body;
    const users = readUsers();
    const user = users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const amt = parseInt(amount);
    if (amt > user.balance) return res.status(400).json({ error: "Solde insuffisant" });
    user.balance -= amt;
    saveUsers(users);
    res.json({ balance: user.balance });
});

// API: Jouer
app.post("/api/play", (req, res) => {
    const { username, caseNumber, bet } = req.body;
    const users = readUsers();
    const user = users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });
    
    const betAmount = parseInt(bet);
    if (betAmount < 50) return res.status(400).json({ error: "Mise minimale 50f" });
    if (betAmount > user.balance) return res.status(400).json({ error: "Solde insuffisant" });
    
    user.balance -= betAmount;
    const winningCase = Math.floor(Math.random() * 6) + 1;
    let gain = 0;
    let message = `La case gagnante est ${winningCase}. `;
    if (parseInt(caseNumber) === winningCase) {
        gain = betAmount * 5;
        user.balance += gain;
        message += `Félicitations ! Vous gagnez ${gain}f.`;
    } else {
        message += "Dommage, vous perdez votre mise.";
    }

    saveUsers(users);
    res.json({ message, balance: user.balance });
});

app.listen(PORT, () => console.log(`Serveur lancé sur http://localhost:${PORT}`));

require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const { v4: uuid } = require("uuid");
const axios = require("axios");
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(express.static(__dirname));
app.use(cors());

const USERS_FILE = "./users.json";
const loadUsers = () => fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : [];
const saveUsers = (d) => fs.writeFileSync(USERS_FILE, JSON.stringify(d, null, 2));

const MONEY_API_KEY = process.env.MONEY_FUSION_API_KEY;
const MONEY_SECRET = process.env.MONEY_FUSION_SECRET;
const PORT = process.env.PORT || 3000;

// --- REGISTER
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  if(users.find(u=>u.username===username)) return res.json({error:"Utilisateur existe"});
  const user = { id: uuid(), username, password, balance:0, totalDeposit:0 };
  users.push(user);
  saveUsers(users);
  res.json({success:true});
});

// --- LOGIN
app.post("/api/login", (req,res)=>{
  const { username, password } = req.body;
  const user = loadUsers().find(u=>u.username===username && u.password===password);
  if(!user) return res.json({error:"Identifiants invalides"});
  res.json(user);
});

// --- PLAY GAME
app.post("/api/play", (req,res)=>{
  const { userId, bet, choice } = req.body;
  const users = loadUsers();
  const user = users.find(u=>u.id===userId);
  if(!user) return res.json({error:"Utilisateur non trouvé"});
  if(bet<200||bet>150000||bet>user.balance) return res.json({error:"Mise invalide"});

  const d1=Math.ceil(Math.random()*6);
  const d2=Math.ceil(Math.random()*6);
  const sum=d1+d2;

  let win=false, multi=0;
  if(choice==="plus" && sum>7) win=true,multi=2.3;
  if(choice==="moins" && sum<7) win=true,multi=2.3;
  if(choice==="egal" && sum===7) win=true,multi=5.8;

  user.balance += win? bet*multi : -bet;
  saveUsers(users);

  res.json({d1,d2,sum,win,balance:user.balance});
});

// --- MONEY FUSION DEPOSIT
app.post("/api/moneyfusion/deposit", async (req,res)=>{
  const { userId, amount } = req.body;
  if(amount<1000) return res.json({error:"Montant minimum 1000 XAF"});
  try {
    const response = await axios.post("https://www.pay.moneyfusion.net/Des/fbb93cb2c1939e83/pay/", {
      userId, amount
    },{
      headers:{
        "Content-Type":"application/json",
        "moneyfusion-private-key":MONEY_API_KEY
      }
    });
    if(response.data.success){
      const users = loadUsers();
      const user = users.find(u=>u.id===userId);
      user.balance += amount;
      user.totalDeposit += amount;
      saveUsers(users);
      res.json({success:true, balance:user.balance});
    } else res.json({error:"Erreur dépôt"});
  } catch(err){
    res.json({error:"Erreur serveur dépôt"});
  }
});

// --- MONEY FUSION WITHDRAW
app.post("/api/moneyfusion/withdraw", async (req,res)=>{
  const { userId, amount } = req.body;
  const users = loadUsers();
  const user = users.find(u=>u.id===userId);
  if(!user) return res.json({error:"Utilisateur non trouvé"});
  if(amount>user.balance) return res.json({error:"Solde insuffisant"});
  if(amount<user.totalDeposit*2) return res.json({error:`Montant min retrait = double dépôt (${user.totalDeposit*2})`});
  try {
    const response = await axios.post("https://pay.moneyfusion.net/api/v1/withdraw", {
      userId, amount
    },{
      headers:{
        "Content-Type":"application/json",
        "moneyfusion-private-key":MONEY_API_KEY
      }
    });
    if(response.data.success){
      user.balance -= amount;
      saveUsers(users);
      res.json({success:true, balance:user.balance});
    } else res.json({error:"Erreur retrait"});
  } catch(err){
    res.json({error:"Erreur serveur retrait"});
  }
});

app.listen(PORT, ()=>console.log(`✅ Serveur lancé sur http://localhost:${PORT}`));

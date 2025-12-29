const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const { v4: uuid } = require("uuid");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(__dirname));

const USERS_FILE = "./users.json";
const loadUsers = () => fs.existsSync(USERS_FILE)?JSON.parse(fs.readFileSync(USERS_FILE)):[];
const saveUsers = (d) => fs.writeFileSync(USERS_FILE,JSON.stringify(d,null,2));

const MONEY_KEY = process.env.MONEYFUSION_PRIVATE_KEY; // ta clé Money Fusion

// REGISTER
app.post("/api/register",(req,res)=>{
  const { username,password }=req.body;
  const users = loadUsers();
  if(users.find(u=>u.username===username)) return res.json({error:"Utilisateur existe"});
  users.push({id:uuid(),username,password,balance:0,totalDeposit:0});
  saveUsers(users);
  res.json({success:true});
});

// LOGIN
app.post("/api/login",(req,res)=>{
  const { username,password }=req.body;
  const user = loadUsers().find(u=>u.username===username && u.password===password);
  if(!user) return res.json({error:"Identifiants invalides"});
  res.json(user);
});

// PLAY
app.post("/api/play",(req,res)=>{
  const { userId, bet, choice }=req.body;
  const users = loadUsers();
  const user = users.find(u=>u.id===userId);
  if(!user) return res.json({error:"Utilisateur non trouvé"});
  if(bet<200||bet>150000||bet>user.balance) return res.json({error:"Mise invalide"});
  const d1=Math.ceil(Math.random()*6), d2=Math.ceil(Math.random()*6), sum=d1+d2;
  let win=false,multi=0;
  if(choice==="plus" && sum>7) win=true,multi=2.3;
  if(choice==="moins" && sum<7) win=true,multi=2.3;
  if(choice==="egal" && sum===7) win=true,multi=5.8;
  user.balance += win?bet*multi:-bet;
  saveUsers(users);
  res.json({d1,d2,sum,win,balance:user.balance});
});

// DEPOSIT
app.post("/api/moneyfusion/deposit", async (req,res)=>{
  const { userId, amount }=req.body;
  if(amount<1000) return res.json({error:"Montant min 1000 XAF"});
  try{
    const response = await axios.post("https://www.pay.moneyfusion.net/Des/fbb93cb2c1939e83/pay",
      { userId, amount },
      { headers:{ "moneyfusion-private-key": MONEY_KEY,"Content-Type":"application/json"}}
    );
    if(response.data.success){
      const users = loadUsers();
      const user = users.find(u=>u.id===userId);
      user.balance += amount;
      user.totalDeposit = (user.totalDeposit||0)+amount;
      saveUsers(users);
      return res.json({success:true,balance:user.balance});
    }else return res.json({error:"Erreur dépôt"});
  }catch(e){return res.json({error:"Erreur serveur dépôt"});}
});

// WITHDRAW
app.post("/api/moneyfusion/withdraw", async (req,res)=>{
  const { userId, amount }=req.body;
  const users = loadUsers();
  const user = users.find(u=>u.id===userId);
  if(!user) return res.json({error:"Utilisateur non trouvé"});
  if(amount>user.balance) return res.json({error:"Solde insuffisant"});
  if(amount < (user.totalDeposit||0)*2) return res.json({error:"Retrait min = double dépôt"});
  try{
    const response = await axios.post("https://www.pay.moneyfusion.net/Des/fbb93cb2c1939e83/pay",
      { userId, amount, type:"withdraw" },
      { headers:{ "moneyfusion-private-key": MONEY_KEY,"Content-Type":"application/json"}}
    );
    if(response.data.success){
      user.balance -= amount;
      saveUsers(users);
      return res.json({success:true,balance:user.balance});
    }else return res.json({error:"Erreur retrait"});
  }catch(e){return res.json({error:"Erreur serveur retrait"});}
});

app.listen(3000,()=>console.log("✅ Serveur lancé sur http://localhost:3000"));

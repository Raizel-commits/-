const user = localStorage.getItem("user");
let bet = 50;
let choice = null;

async function loadBalance(){
  const r = await fetch("/api/balance/" + user);
  const d = await r.json();
  balance.innerText = d.balance;
}

function select(c){
  choice = c;
  document.querySelectorAll(".card")
    .forEach(e=>e.classList.remove("active"));
  document.getElementById(c).classList.add("active");
}

function min(){ bet = 50; upd(); }
function x2(){ bet *= 2; upd(); }
function half(){ bet = Math.max(50, bet/2); upd(); }
function max(){ bet = balance.innerText; upd(); }

function upd(){ document.getElementById("bet").innerText = bet; }

async function play(){
  const r = await fetch("/api/play",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username:user,bet,choice})
  });
  const d = await r.json();
  d1.innerText="🎲 "+d.d1;
  d2.innerText="🎲 "+d.d2;
  result.innerText=d.win?"🎉 GAGNÉ":"❌ PERDU";
  loadBalance();
}

loadBalance();
upd();

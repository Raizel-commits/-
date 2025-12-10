// Front JS : appel au backend /api
(function(){
  const api = window.API_BASE; // ex: https://ton-backend.onrender.com/api
  const joined = document.getElementById('joined');
  const phone = document.getElementById('phone');
  const username = document.getElementById('username');
  const generate = document.getElementById('generate');
  const statusText = document.getElementById('statusText');
  const qrImg = document.getElementById('qrImg');
  const qrContainer = document.getElementById('qrContainer');
  let currentMode = 'pairing';

  function setStatus(t, ok=true){ statusText.textContent = t; const dot = document.querySelector('.dot'); dot.style.background = ok ? '#8be58b' : '#ffb86b'; }

  document.querySelectorAll('.mode').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.mode').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.mode;
      if (currentMode === 'qr') {
        qrContainer.style.display = 'block';
      } else {
        qrContainer.style.display = 'none';
        qrImg.src = '';
      }
    });
  });

  generate.addEventListener('click', async () => {
    if (!joined.checked) { setStatus('Veuillez rejoindre la chaîne officielle.', false); return; }
    const phoneVal = (phone.value||'').trim();
    const userVal = (username.value||'').trim();
    if (!/^\d{6,15}$/.test(phoneVal)) { setStatus('Numéro invalide.', false); return; }
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(userVal)) { setStatus("Nom d'utilisateur invalide.", false); return; }

    setStatus('Contacte le serveur...', true);
    generate.disabled = true;
    try {
      if (currentMode === 'pairing') {
        const res = await fetch(api + '/pairing', {
          method:'POST', headers:{'content-type':'application/json'},
          body: JSON.stringify({ username: userVal, phone: phoneVal, mode: 'pairing' })
        });
        const json = await res.json();
        if (json.pairingCode) {
          setStatus('Code généré : ' + json.pairingCode);
        } else {
          setStatus(json.error || 'Erreur serveur', false);
        }
      } else {
        // qr mode: POST returns PNG image
        const resp = await fetch(api + '/pairing', {
          method:'POST', headers:{'content-type':'application/json'},
          body: JSON.stringify({ username: userVal, phone: phoneVal, mode: 'qr' })
        });
        if (resp.ok && resp.headers.get('content-type') && resp.headers.get('content-type').includes('image')) {
          const blob = await resp.blob();
          qrImg.src = URL.createObjectURL(blob);
          setStatus('QR généré — scannez-le dans WhatsApp.');
        } else {
          const j = await resp.json().catch(()=>null);
          setStatus((j && j.error) ? j.error : 'Erreur génération QR', false);
        }
      }
    } catch (e) {
      console.error(e);
      setStatus('Erreur réseau / serveur', false);
    } finally {
      generate.disabled = false;
    }
  });

})();

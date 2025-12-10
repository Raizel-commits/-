# RAIZEL XMD — Frontend + Backend

## Structure
- `frontend/` : HTML/CSS/JS UI
- `backend/`  : Node.js + Baileys API

## Déploiement rapide (Render)
1. Crée 2 repos ou un seul repo monorepo.
2. Deploy `backend/` sur Render as a Web Service.
   - Build: `npm install`
   - Start: `npm start`
3. Serve `frontend/` (optionnel: héberge sur le même domaine ou en static site).
4. Dans `frontend/app.js`, ajuste `API_BASE` si backend est sur un domaine différent.

## Notes
- Sessions sont persistées dans `backend/sessions/<username>`. Sur Render le disque est persistant pour le service unique, mais si tu veux scalabilité, migre les sessions sur S3/DB.
- Pour sécurité, ajoute authentification sur routes sensibles.

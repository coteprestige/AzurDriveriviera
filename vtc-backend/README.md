# Azur Prestige — Backend de réservation

Calcule le prix réel d'une course (distance + durée via Google Maps) et encaisse
le paiement via Stripe, avec un montant qui ne peut pas être trafiqué côté client.

## Ce qu'il te faut avant de démarrer

1. **Une clé Google Maps** avec l'API "Distance Matrix API" activée
   → console.cloud.google.com → créer un projet → activer "Distance Matrix API"
   → créer une clé API, la restreindre à cette API précisément
   → une carte bancaire est demandée par Google mais l'usage reste gratuit jusqu'à un
   volume élevé de requêtes/mois

2. **Tes clés Stripe** (tu as déjà un compte pro ✓)
   → dashboard.stripe.com → Développeurs → Clés API
   → commence avec la clé de **test** (`sk_test_...`) pour vérifier que tout fonctionne
   → tu passeras en clé live (`sk_live_...`) une fois les tests validés

## Installation en local (pour tester avant de mettre en ligne)

```bash
cd vtc-backend
npm install
cp .env.example .env
# ouvre .env et remplis STRIPE_SECRET_KEY et GOOGLE_MAPS_API_KEY
npm start
```

Le site sera visible sur http://localhost:3000

## Mise en ligne (déploiement gratuit sur Render)

1. Crée un compte sur render.com
2. "New +" → "Web Service" → connecte ce dossier (ou pousse-le sur un repo GitHub)
3. Render détecte Node automatiquement :
   - Build command : `npm install`
   - Start command : `npm start`
4. Dans l'onglet "Environment", ajoute tes variables :
   - `STRIPE_SECRET_KEY`
   - `GOOGLE_MAPS_API_KEY`
   - `SITE_URL` → l'URL que Render te donne (ex: `https://azur-prestige-api.onrender.com`)
   - `STRIPE_WEBHOOK_SECRET` → voir étape suivante
5. Une fois déployé, retourne dans `public/index.html` et remplace :
   ```js
   const API_BASE_URL = "https://TON-BACKEND-A-DEPLOYER.onrender.com";
   ```
   par ta vraie URL Render.

## Configurer le webhook Stripe (confirmation de paiement)

1. Dashboard Stripe → Développeurs → Webhooks → "Ajouter un endpoint"
2. URL : `https://ton-url-render.onrender.com/api/webhook`
3. Événement à écouter : `checkout.session.completed`
4. Stripe te donne un secret `whsec_...` → colle-le dans `STRIPE_WEBHOOK_SECRET`

C'est ce webhook qui confirmera qu'un paiement a réellement eu lieu — c'est le
bon endroit pour brancher une notification vers ton téléphone ou vers Make.com
(il y a un commentaire `TODO` dans `server.js` à l'endroit exact où l'ajouter).

## Ajuster tes prix

Tout est dans `server.js`, en haut du fichier, objet `PRICING` :
- `baseFare` — prise en charge
- `perKm` — prix par kilomètre
- `perMinute` — prix par minute de trajet
- `minimumFare` — tarif plancher
- `nightSurchargeRate` — majoration de nuit (21h–6h)

## Ce qui manque encore avant un vrai lancement

- Un vrai numéro de dispatching relié au webhook (SMS, WhatsApp Business API, ou Make.com)
- Des CGV/mentions légales à jour (SIRET, assurance transport)
- Passer les clés Stripe et Google Maps en mode "live" une fois les tests validés
- Un nom de domaine pointant vers Render (ou l'hébergeur choisi)

// Azur Prestige — Backend de réservation
// Calcule le prix réel d'une course (Google Maps Distance Matrix)
// et crée un paiement Stripe Checkout pour ce montant exact.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

// ---------- Grille tarifaire ----------
// À ajuster selon ta politique de prix réelle.
const PRICING = {
  baseFare: 8,        // prise en charge, en euros
  perKm: 1.7,          // prix par kilomètre
  perMinute: 0.35,      // prix par minute (temps de trajet)
  minimumFare: 25,      // tarif plancher, quel que soit le trajet
  nightSurchargeRate: 0.15, // +15% entre 21h et 6h
};

// ---------- Catégories de véhicules ----------
// multiplier appliqué au tarif de base pour chaque gamme.
const VEHICLE_CLASSES = [
  { id: 'standard', label: 'Standard', seats: 4, multiplier: 1,    description: 'Véhicule simple et efficace pour vos trajets du quotidien.' },
  { id: 'confort',  label: 'Confort',  seats: 4, multiplier: 1.3,  description: 'Plus d\'espace et de confort pour un trajet détendu.' },
  { id: 'berline',  label: 'Berline',  seats: 4, multiplier: 1.6,  description: 'Véhicule haut de gamme, présentation soignée, idéal pour vos rendez-vous.' },
  { id: 'van',      label: 'Van',      seats: 7, multiplier: 1.8,  description: 'Idéal pour les groupes, familles ou bagages volumineux.' },
];

function isNightTime(date) {
  const hour = new Date(date).getHours();
  return hour >= 21 || hour < 6;
}

function computeFare(distanceMeters, durationSeconds, pickupDateTime) {
  const distanceKm = distanceMeters / 1000;
  const durationMin = durationSeconds / 60;
  let basePrice = PRICING.baseFare + distanceKm * PRICING.perKm + durationMin * PRICING.perMinute;

  if (pickupDateTime && isNightTime(pickupDateTime)) {
    basePrice *= 1 + PRICING.nightSurchargeRate;
  }

  const fares = VEHICLE_CLASSES.map((vc) => {
    const price = Math.max(basePrice * vc.multiplier, PRICING.minimumFare * vc.multiplier);
    return {
      id: vc.id,
      label: vc.label,
      seats: vc.seats,
      description: vc.description,
      price: Math.round(price * 100) / 100,
    };
  });

  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMin: Math.round(durationMin),
    fares,
  };
}

// ---------- POST /api/fare ----------
// body: { depart: "adresse", arrivee: "adresse", date: "2026-07-20", heure: "14:30" }
app.post('/api/fare', async (req, res) => {
  try {
    const { depart, arrivee, date, heure } = req.body;
    if (!depart || !arrivee) {
      return res.status(400).json({ error: 'depart et arrivee sont requis.' });
    }

    const params = new URLSearchParams({
      origins: depart,
      destinations: arrivee,
      key: GOOGLE_MAPS_API_KEY,
      language: 'fr',
      region: 'fr',
    });

    const response = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params}`);
    const data = await response.json();

    const element = data?.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') {
      return res.status(422).json({ error: 'Impossible de calculer ce trajet. Vérifiez les adresses.' });
    }

    const pickupDateTime = date && heure ? `${date}T${heure}` : null;
    const fare = computeFare(element.distance.value, element.duration.value, pickupDateTime);

    res.json({
      ...fare,
      distanceText: element.distance.text,
      durationText: element.duration.text,
    });
  } catch (err) {
    console.error('Erreur /api/fare', err);
    res.status(500).json({ error: 'Erreur serveur lors du calcul du tarif.' });
  }
});

// ---------- POST /api/checkout ----------
// body: { price, vehicleLabel, depart, arrivee, date, heure, nom, telephone, passagers }
app.post('/api/checkout', async (req, res) => {
  try {
    const { price, vehicleLabel, depart, arrivee, date, heure, nom, telephone, passagers } = req.body;
    if (!price || price < PRICING.minimumFare - 0.01) {
      return res.status(400).json({ error: 'Montant invalide.' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: Math.round(price * 100), // en centimes
            product_data: {
              name: `Course ${vehicleLabel || 'VTC'} — ${depart} → ${arrivee}`,
              description: `${date} à ${heure} · ${passagers} passager(s) · ${nom}`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: { depart, arrivee, date, heure, nom, telephone, passagers: String(passagers), vehicleLabel: vehicleLabel || '' },
      success_url: `${SITE_URL}/merci.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/#bookingForm`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Erreur /api/checkout', err);
    res.status(500).json({ error: 'Erreur serveur lors de la création du paiement.' });
  }
});

// ---------- Webhook Stripe : confirmation de paiement ----------
// Reçoit l'événement Stripe une fois le paiement réellement effectué.
// C'est ICI qu'il faut notifier le dispatching (email, WhatsApp, ou webhook Make.com).
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Signature webhook invalide', err.message);
    return res.status(400).send('Webhook invalide');
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('✅ Paiement confirmé :', session.metadata);

    // TODO : brancher ici une notification réelle, par exemple un webhook Make.com
    // fetch('https://hook.make.com/XXXXX', { method: 'POST', body: JSON.stringify(session.metadata) })
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Azur Prestige backend en ligne sur le port ${PORT}`));

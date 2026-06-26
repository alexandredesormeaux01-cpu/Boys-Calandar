const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Stockage en mémoire des sessions actives: token -> username
const sessions = {};

// Middleware d'authentification (vérifie si l'utilisateur existe toujours)
async function authenticate(req, res, next) {
  const token = req.headers['authorization'];
  if (!token || !sessions[token]) {
    return res.status(401).json({ error: 'Non autorisé. Veuillez vous connecter.' });
  }
  const username = sessions[token];
  try {
    const user = await db.getUser(username);
    if (!user) {
      delete sessions[token];
      return res.status(401).json({ error: 'Votre compte n\'existe plus.' });
    }
    req.username = user.username;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Routes d'authentification
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.trim().length < 2 || password.length < 4) {
    return res.status(400).json({ error: 'Identifiants invalides (nom >= 2 caract., mdp >= 4 caract.).' });
  }

  try {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    await db.addUser(username.trim(), passwordHash);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Veuillez saisir votre nom et mot de passe.' });
  }

  try {
    const user = await db.getUser(username);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(400).json({ error: 'Nom ou mot de passe incorrect.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    sessions[token] = user.username;
    res.json({ token, username: user.username });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/logout', (req, res) => {
  const token = req.headers['authorization'];
  if (token) {
    delete sessions[token];
  }
  res.json({ success: true });
});

// Récupérer le profil connecté
app.get('/api/me', authenticate, (req, res) => {
  res.json({ username: req.username });
});

// Récupérer les indisponibilités de l'utilisateur connecté
app.get('/api/unavailabilities/my', authenticate, async (req, res) => {
  try {
    const list = await db.getUserUnavailabilities(req.username);
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Enregistrer les indisponibilités de l'utilisateur connecté
app.post('/api/unavailabilities/my', authenticate, async (req, res) => {
  const list = req.body; // doit être un tableau de { date, startHour, endHour }
  if (!Array.isArray(list)) {
    return res.status(400).json({ error: 'Données invalides.' });
  }
  try {
    const updated = await db.setUnavailabilities(req.username, list);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Récupérer toutes les indisponibilités de groupe
app.get('/api/unavailabilities/group', async (req, res) => {
  try {
    const all = await db.getUnavailabilities();
    res.json(all);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Liste de tous les utilisateurs pour information
app.get('/api/users', async (req, res) => {
  try {
    const users = (await db.getUsers()).map(u => u.username);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Supprimer un utilisateur du groupe (réservé à l'administrateur)
app.delete('/api/users/:username', authenticate, async (req, res) => {
  const adminUsername = 'alexandre.desormeaux01@gmail.com';
  if (req.username.toLowerCase() !== adminUsername.toLowerCase()) {
    return res.status(403).json({ error: 'Seul l\'administrateur peut éjecter des membres.' });
  }

  const userToEject = req.params.username;
  if (userToEject.toLowerCase() === adminUsername.toLowerCase()) {
    return res.status(400).json({ error: 'Vous ne pouvez pas vous éjecter vous-même.' });
  }

  try {
    await db.deleteUser(userToEject);

    // Expulser l'utilisateur de ses sessions actives s'il est connecté
    for (const token in sessions) {
      if (sessions[token].toLowerCase() === userToEject.toLowerCase()) {
        delete sessions[token];
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Rechercher des créneaux libres de groupe
app.post('/api/activities/search', async (req, res) => {
  const { duration, excludeWeekdaysPM, searchDays = 30 } = req.body;
  const dur = parseInt(duration, 10);

  if (isNaN(dur) || dur <= 0 || dur > 24) {
    return res.status(400).json({ error: 'La durée doit être comprise entre 1 et 24 heures.' });
  }

  try {
    const allUnavailabilities = await db.getUnavailabilities();
    const allUsers = (await db.getUsers()).map(u => u.username.toLowerCase());

    if (allUsers.length === 0) {
      return res.json([]);
    }

    const availableSlots = [];
    const startDay = new Date();
    
    // Analyser les prochains jours
    for (let d = 0; d < searchDays; d++) {
      const currentDate = new Date(startDay);
      currentDate.setDate(startDay.getDate() + d);
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayOfWeek = currentDate.getDay(); // 0 = Dimanche, 1 = Lundi, ..., 6 = Samedi

      // Pour chaque heure possible de début (de 08:00 à 22:00)
      for (let startHour = 8; startHour <= 22 - dur; startHour++) {
        const endHour = startHour + dur;

        // 1. Appliquer le filtre d'exclusion de la semaine après-midi (Lundi au Vendredi de 12:00 à 18:00 par exemple)
        let isExcluded = false;
        if (excludeWeekdaysPM && dayOfWeek >= 1 && dayOfWeek <= 5) {
          if (!(endHour <= 12 || startHour >= 18)) {
            isExcluded = true;
          }
        }

        if (isExcluded) continue;

        // 2. Vérifier si un des utilisateurs est indisponible sur ce créneau
        let slotFree = true;
        for (const u of allUnavailabilities) {
          if (u.date === dateStr) {
            if (!(endHour <= u.startHour || startHour >= u.endHour)) {
              slotFree = false;
              break;
            }
          }
        }

        if (slotFree) {
          availableSlots.push({
            date: dateStr,
            dayOfWeek: currentDate.toLocaleDateString('fr-FR', { weekday: 'long' }),
            startHour,
            endHour
          });
        }
      }
    }

    res.json(availableSlots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fallback pour servir index.html sur n'importe quel autre chemin
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrage de la base de données puis du serveur
async function start() {
  try {
    await db.initDb();
    app.listen(PORT, () => {
      console.log(`Serveur actif sur http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Erreur au démarrage du serveur:', error);
    process.exit(1);
  }
}

start();

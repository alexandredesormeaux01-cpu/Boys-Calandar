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


// Rechercher des créneaux libres de groupe (Moteur multi-format)
app.post('/api/activities/search', async (req, res) => {
  const { durationType = 'hours', duration, excludeWeekdaysPM, searchDays = 30, startRange, endRange, daysCount } = req.body;
  
  try {
    const allUnavailabilities = await db.getUnavailabilities();
    const allUsers = (await db.getUsers()).map(u => u.username.toLowerCase());

    if (allUsers.length === 0) {
      return res.json([]);
    }

    const availableSlots = [];
    const startDay = new Date();
    
    // Vérifie si une période est libre pour l'ensemble des membres du groupe
    function isPeriodFree(dateStr, startHour, endHour) {
      for (const u of allUnavailabilities) {
        if (u.date === dateStr) {
          if (!(endHour <= u.startHour || startHour >= u.endHour)) {
            return false;
          }
        }
      }
      return true;
    }

    // Récupérer la date formatée YYYY-MM-DD et le nom du jour de la semaine
    function getDateInfo(dateObj) {
      return {
        date: dateObj.toISOString().split('T')[0],
        dayOfWeek: dateObj.toLocaleDateString('fr-FR', { weekday: 'long' })
      };
    }

    if (durationType === 'hours') {
      const dur = parseInt(duration, 10) || 2;
      const limitStart = startRange !== undefined ? parseInt(startRange, 10) : 8;
      const limitEnd = endRange !== undefined ? parseInt(endRange, 10) : 22;

      for (let d = 0; d < searchDays; d++) {
        const currentDate = new Date(startDay);
        currentDate.setDate(startDay.getDate() + d);
        const { date, dayOfWeek } = getDateInfo(currentDate);
        const dayOfWeekNum = currentDate.getDay();

        for (let startHour = limitStart; startHour <= limitEnd - dur; startHour++) {
          const endHour = startHour + dur;

          let isExcluded = false;
          if (excludeWeekdaysPM && dayOfWeekNum >= 1 && dayOfWeekNum <= 5) {
            if (!(endHour <= 12 || startHour >= 18)) {
              isExcluded = true;
            }
          }

          if (isExcluded) continue;

          if (isPeriodFree(date, startHour, endHour)) {
            availableSlots.push({
              type: 'hours',
              date: date,
              dayOfWeek: dayOfWeek,
              startHour,
              endHour
            });
          }
        }
      }
    } 
    else if (durationType === 'overnight') {
      // Soirée / Nuitée : libre de 18h à 22h le soir J et de 8h à 9h le matin J+1
      for (let d = 0; d < searchDays - 1; d++) {
        const dateJ = new Date(startDay);
        dateJ.setDate(startDay.getDate() + d);
        const dateJPlus1 = new Date(startDay);
        dateJPlus1.setDate(startDay.getDate() + d + 1);

        const infoJ = getDateInfo(dateJ);
        const infoJPlus1 = getDateInfo(dateJPlus1);

        if (isPeriodFree(infoJ.date, 18, 22) && isPeriodFree(infoJPlus1.date, 8, 9)) {
          availableSlots.push({
            type: 'overnight',
            date: infoJ.date,
            endDate: infoJPlus1.date,
            dayOfWeek: infoJ.dayOfWeek,
            label: `Soirée & Nuitée (du ${infoJ.dayOfWeek} soir au lendemain matin)`
          });
        }
      }
    }
    else if (durationType === 'full-day') {
      // Journée complète : libre de 8h à 22h
      for (let d = 0; d < searchDays; d++) {
        const currentDate = new Date(startDay);
        currentDate.setDate(startDay.getDate() + d);
        const { date, dayOfWeek } = getDateInfo(currentDate);

        if (isPeriodFree(date, 8, 22)) {
          availableSlots.push({
            type: 'full-day',
            date: date,
            dayOfWeek: dayOfWeek,
            label: `Journée complète (08h00 - 22h00)`
          });
        }
      }
    }
    else if (durationType === 'weekend') {
      // Week-end complet : Samedi et Dimanche consécutifs entièrement libres (8h à 22h)
      for (let d = 0; d < searchDays - 1; d++) {
        const dateSat = new Date(startDay);
        dateSat.setDate(startDay.getDate() + d);
        
        if (dateSat.getDay() === 6) { // Samedi
          const dateSun = new Date(startDay);
          dateSun.setDate(startDay.getDate() + d + 1);

          const infoSat = getDateInfo(dateSat);
          const infoSun = getDateInfo(dateSun);

          if (isPeriodFree(infoSat.date, 8, 22) && isPeriodFree(infoSun.date, 8, 22)) {
            availableSlots.push({
              type: 'weekend',
              date: infoSat.date,
              endDate: infoSun.date,
              label: `Week-end complet (Samedi & Dimanche)`
            });
          }
        }
      }
    }
    else if (durationType === 'consecutive-days') {
      // Plusieurs jours consécutifs : N jours d'affilée libres de 8h à 22h
      const nDays = parseInt(daysCount, 10) || 2;
      if (nDays <= 1 || nDays > 7) {
        return res.status(400).json({ error: 'Le nombre de jours consécutifs doit être compris entre 2 et 7.' });
      }

      for (let d = 0; d <= searchDays - nDays; d++) {
        let allDaysFree = true;
        const daysList = [];

        for (let i = 0; i < nDays; i++) {
          const checkDate = new Date(startDay);
          checkDate.setDate(startDay.getDate() + d + i);
          const info = getDateInfo(checkDate);
          
          if (!isPeriodFree(info.date, 8, 22)) {
            allDaysFree = false;
            break;
          }
          daysList.push(info);
        }

        if (allDaysFree) {
          availableSlots.push({
            type: 'consecutive-days',
            date: daysList[0].date,
            endDate: daysList[daysList.length - 1].date,
            daysCount: nDays,
            label: `Séjour de ${nDays} jours consécutifs`
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

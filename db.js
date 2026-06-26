const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DB_PATH = path.join(__dirname, 'db.json');
const isPostgres = !!process.env.DATABASE_URL;

let pool = null;

// Initialisation de la base de données
async function initDb() {
  if (isPostgres) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });

    // Créer les tables si elles n'existent pas
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(100) PRIMARY KEY,
        password_hash TEXT NOT NULL
      );
    `;
    const createUnavailTable = `
      CREATE TABLE IF NOT EXISTS unavailabilities (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        date VARCHAR(20) NOT NULL,
        start_hour INT NOT NULL,
        end_hour INT NOT NULL
      );
    `;

    await pool.query(createUsersTable);
    await pool.query(createUnavailTable);
    console.log('Connecté à PostgreSQL (Neon/Render) et tables vérifiées.');
  } else {
    // Fallback JSON local
    if (!fs.existsSync(DB_PATH)) {
      const initialData = {
        users: [],
        unavailabilities: [],
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2), 'utf8');
    }
    console.log('Utilisation de la base de données locale db.json.');
  }
}

// Helpers pour JSON
function readDbSync() {
  const data = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(data);
}

function writeDbSync(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  initDb,

  getUsers: async () => {
    if (isPostgres) {
      const res = await pool.query('SELECT username FROM users');
      return res.rows.map(r => ({ username: r.username }));
    } else {
      const db = readDbSync();
      return db.users;
    }
  },

  addUser: async (username, passwordHash) => {
    if (isPostgres) {
      // Vérifier si l'utilisateur existe déjà
      const check = await pool.query('SELECT username FROM users WHERE LOWER(username) = LOWER($1)', [username]);
      if (check.rows.length > 0) {
        throw new Error('Cet utilisateur existe déjà.');
      }
      await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, passwordHash]);
      return { username, passwordHash };
    } else {
      const db = readDbSync();
      if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
        throw new Error('Cet utilisateur existe déjà.');
      }
      const newUser = { username, passwordHash };
      db.users.push(newUser);
      writeDbSync(db);
      return newUser;
    }
  },

  getUser: async (username) => {
    if (isPostgres) {
      const res = await pool.query('SELECT username, password_hash AS "passwordHash" FROM users WHERE LOWER(username) = LOWER($1)', [username]);
      return res.rows[0] || null;
    } else {
      const db = readDbSync();
      return db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    }
  },

  getUnavailabilities: async () => {
    if (isPostgres) {
      const res = await pool.query('SELECT username, date, start_hour AS "startHour", end_hour AS "endHour" FROM unavailabilities');
      return res.rows;
    } else {
      const db = readDbSync();
      return db.unavailabilities;
    }
  },

  setUnavailabilities: async (username, list) => {
    if (isPostgres) {
      // Supprimer les indisponibilités existantes de l'utilisateur
      await pool.query('DELETE FROM unavailabilities WHERE LOWER(username) = LOWER($1)', [username]);
      
      // Insérer les nouvelles
      for (const item of list) {
        await pool.query(
          'INSERT INTO unavailabilities (username, date, start_hour, end_hour) VALUES ($1, $2, $3, $4)',
          [username, item.date, parseInt(item.startHour, 10), parseInt(item.endHour, 10)]
        );
      }
      return list.map(item => ({
        username,
        date: item.date,
        startHour: parseInt(item.startHour, 10),
        endHour: parseInt(item.endHour, 10)
      }));
    } else {
      const db = readDbSync();
      db.unavailabilities = db.unavailabilities.filter(u => u.username.toLowerCase() !== username.toLowerCase());
      const newList = list.map(item => ({
        username,
        date: item.date,
        startHour: parseInt(item.startHour, 10),
        endHour: parseInt(item.endHour, 10)
      }));
      db.unavailabilities.push(...newList);
      writeDbSync(db);
      return newList;
    }
  },

  getUserUnavailabilities: async (username) => {
    if (isPostgres) {
      const res = await pool.query('SELECT username, date, start_hour AS "startHour", end_hour AS "endHour" FROM unavailabilities WHERE LOWER(username) = LOWER($1)', [username]);
      return res.rows;
    } else {
      const db = readDbSync();
      return db.unavailabilities.filter(u => u.username.toLowerCase() === username.toLowerCase());
    }
  }
};

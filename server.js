require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const { runSeed, DB_PATH } = require('./database/seed');

// Auto-seed: create database if it doesn't exist (for Railway / fresh deploys)
if (!fs.existsSync(DB_PATH)) {
    console.log('Base de datos no encontrada. Ejecutando seed...');
    runSeed();
}

const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Database
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Migration: ensure new columns exist on existing databases
function ensureColumn(name, definition, initSql) {
    const columns = db.prepare(`PRAGMA table_info(products)`).all();
    if (!columns.some(c => c.name === name)) {
        console.log(`Agregando columna "${name}" a la tabla products...`);
        db.exec(`ALTER TABLE products ADD COLUMN ${name} ${definition}`);
        if (initSql) db.exec(initSql);
    }
}
ensureColumn('show_codes', 'INTEGER DEFAULT 1');
ensureColumn('display_order', 'INTEGER DEFAULT 0', 'UPDATE products SET display_order = id WHERE display_order = 0');

db.exec(`CREATE TABLE IF NOT EXISTS existencia_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    file_name TEXT NOT NULL,
    uploaded_at TEXT DEFAULT (datetime('now'))
)`);

app.locals.db = db;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'default-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 4 } // 4 hours
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Routes
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

// SPA fallback
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

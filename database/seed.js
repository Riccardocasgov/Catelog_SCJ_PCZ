const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'catalog.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function parseSpec(specStr, key) {
    const patterns = [
        new RegExp(key + '\\s*:\\s*(.+)', 'i'),
        new RegExp(key + '\\s+([\\w\\d]+)\\s*:', 'i'),
        new RegExp(key + '([\\w\\d]+)\\s*:', 'i'),
    ];
    for (const pat of patterns) {
        const m = specStr.match(pat);
        if (m && m[1] && m[1].trim()) {
            return m[1].trim();
        }
    }
    return '';
}

function runSeed() {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

    if (fs.existsSync(DB_PATH)) {
        fs.unlinkSync(DB_PATH);
        console.log('Base de datos anterior eliminada.');
    }

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
    console.log('Esquema creado.');

    // Create admin user
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'admin123';
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(adminUser, hash);
    console.log(`Usuario admin "${adminUser}" creado.`);

    // Extract product data from index.html
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

    const startMarker = 'const generateProducts = () => {';
    const startIdx = html.indexOf(startMarker);
    const returnIdx = html.indexOf('return [', startIdx);
    const endIdx = html.indexOf('];', returnIdx);
    const arrayStr = html.substring(returnIdx + 'return ['.length, endIdx);

    const productRegex = /\{\s*id\s*:\s*(\d+)\s*,\s*name\s*:\s*"([^"]*?)"\s*,\s*category\s*:\s*"([^"]*?)"\s*,\s*(?:brand\s*:\s*"([^"]*?)"\s*,\s*)?image\s*:\s*"([^"]*?)"\s*,\s*specs\s*:\s*\[(.*?)\]\s*,\s*price\s*:\s*([\d.]+)/g;

    const insert = db.prepare(`
        INSERT INTO products (name, description, category, brand, image, clave_z, clave_scj, upc, price, show_codes, display_order)
        VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    const insertMany = db.transaction((products) => {
        products.forEach((p, idx) => {
            insert.run(p.name, p.category, p.brand, p.image, p.clave_z, p.clave_scj, p.upc, p.price, idx + 1);
        });
    });

    const products = [];
    let match;
    while ((match = productRegex.exec(arrayStr)) !== null) {
        const name = match[2];
        const category = match[3];
        const brand = match[4] || '';
        const image = match[5];
        const specsRaw = match[6];
        const price = parseFloat(match[7]) || 0;

        let clave_z = '', clave_scj = '', upc = '';
        const specItems = specsRaw.match(/"([^"]+)"/g) || [];
        for (const spec of specItems) {
            const s = spec.replace(/"/g, '');
            if (s.toLowerCase().includes('clave z')) {
                clave_z = parseSpec(s, 'Clave Z');
            } else if (s.toLowerCase().includes('clave scj') || s.toLowerCase().includes('scj')) {
                clave_scj = parseSpec(s, 'Clave SCJ');
            } else if (s.toLowerCase().includes('upc')) {
                upc = parseSpec(s, 'UPC');
            }
        }

        products.push({ name, category, brand, image, clave_z, clave_scj, upc, price });
    }

    insertMany(products);
    console.log(`${products.length} productos insertados.`);

    db.close();
    console.log('Seed completado exitosamente.');
}

// Export for use by server.js
module.exports = { runSeed, DB_PATH };

// Run directly if called from command line
if (require.main === module) {
    runSeed();
}

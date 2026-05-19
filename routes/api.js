const express = require('express');
const router = express.Router();

// GET /api/products - List all products with optional filters
router.get('/products', (req, res) => {
    const db = req.app.locals.db;
    const { category, brand, search } = req.query;

    let sql = 'SELECT * FROM products WHERE show_codes = 1';
    const params = [];

    if (category && category !== 'todos') {
        sql += ' AND category = ?';
        params.push(category);
    }

    if (brand) {
        sql += ' AND brand = ?';
        params.push(brand);
    }

    if (search) {
        sql += ' AND (name LIKE ? OR clave_z LIKE ? OR clave_scj LIKE ? OR upc LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term, term, term);
    }

    sql += ' ORDER BY display_order ASC, id ASC';

    const products = db.prepare(sql).all(...params);
    res.json(products);
});

// GET /api/products/:id - Single product
router.get('/products/:id', (req, res) => {
    const db = req.app.locals.db;
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND show_codes = 1').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(product);
});

// GET /api/categories - Distinct categories
router.get('/categories', (req, res) => {
    const db = req.app.locals.db;
    const rows = db.prepare("SELECT DISTINCT category FROM products WHERE category != '' AND show_codes = 1 ORDER BY category").all();
    res.json(rows.map(r => r.category));
});

// GET /api/brands - Distinct brands, optionally filtered by category
router.get('/brands', (req, res) => {
    const db = req.app.locals.db;
    const { category } = req.query;
    let sql = "SELECT DISTINCT brand FROM products WHERE brand != '' AND show_codes = 1";
    const params = [];

    if (category && category !== 'todos') {
        sql += ' AND category = ?';
        params.push(category);
    }

    sql += ' ORDER BY brand';
    const rows = db.prepare(sql).all(...params);
    res.json(rows.map(r => r.brand));
});

// GET /api/existencia - Retrieve stored inventory data
router.get('/existencia', (req, res) => {
    const db = req.app.locals.db;
    const row = db.prepare('SELECT data, file_name, uploaded_at FROM existencia_cache WHERE id = 1').get();
    if (!row) return res.json({ exists: false });
    res.json({ exists: true, rows: JSON.parse(row.data), fileName: row.file_name, uploadedAt: row.uploaded_at });
});

// POST /api/existencia - Store inventory data from CSV
router.post('/existencia', (req, res) => {
    const db = req.app.locals.db;
    const { rows, fileName } = req.body;
    if (!rows || !rows.length) return res.status(400).json({ error: 'No hay datos' });

    db.prepare(`INSERT OR REPLACE INTO existencia_cache (id, data, file_name, uploaded_at)
                VALUES (1, ?, ?, datetime('now'))`)
      .run(JSON.stringify(rows), fileName || 'unknown.csv');

    res.json({ message: 'Datos guardados', count: rows.length });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { requireAuth } = require('../middleware/auth');

// Multer config for image uploads
const storage = multer.diskStorage({
    destination: path.join(__dirname, '..', 'public', 'uploads'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
        cb(null, name);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        const ok = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
        cb(null, ok);
    }
});

// POST /admin/login
router.post('/login', (req, res) => {
    const db = req.app.locals.db;
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    req.session.admin = { id: user.id, username: user.username };
    res.json({ message: 'Login exitoso', username: user.username });
});

// POST /admin/logout
router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Sesión cerrada' });
});

// GET /admin/check - Check if logged in
router.get('/check', (req, res) => {
    if (req.session && req.session.admin) {
        return res.json({ authenticated: true, username: req.session.admin.username });
    }
    res.json({ authenticated: false });
});

// POST /admin/upload - Upload image
router.post('/upload', requireAuth, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ninguna imagen' });
    res.json({ url: '/uploads/' + req.file.filename });
});

// POST /admin/products - Create product
router.post('/products', requireAuth, (req, res) => {
    const db = req.app.locals.db;
    const { name, description, category, brand, image, clave_z, clave_scj, upc, price, show_codes } = req.body;

    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });

    const maxOrder = db.prepare('SELECT COALESCE(MAX(display_order), 0) AS m FROM products').get().m;

    const result = db.prepare(`
        INSERT INTO products (name, description, category, brand, image, clave_z, clave_scj, upc, price, show_codes, display_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        name,
        description || '',
        category || '',
        brand || '',
        image || '',
        clave_z || '',
        clave_scj || '',
        upc || '',
        parseFloat(price) || 0,
        show_codes === false || show_codes === 0 ? 0 : 1,
        maxOrder + 1
    );

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(product);
});

// PUT /admin/products/:id - Update product
router.put('/products/:id', requireAuth, (req, res) => {
    const db = req.app.locals.db;
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

    const { name, description, category, brand, image, clave_z, clave_scj, upc, price, show_codes } = req.body;

    const nextShowCodes = (show_codes === undefined || show_codes === null)
        ? existing.show_codes
        : (show_codes === false || show_codes === 0 ? 0 : 1);

    db.prepare(`
        UPDATE products SET name=?, description=?, category=?, brand=?, image=?, clave_z=?, clave_scj=?, upc=?, price=?, show_codes=?, updated_at=datetime('now')
        WHERE id=?
    `).run(
        name ?? existing.name,
        description ?? existing.description,
        category ?? existing.category,
        brand ?? existing.brand,
        image ?? existing.image,
        clave_z ?? existing.clave_z,
        clave_scj ?? existing.clave_scj,
        upc ?? existing.upc,
        price != null ? parseFloat(price) : existing.price,
        nextShowCodes,
        req.params.id
    );

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json(updated);
});

// PATCH /admin/products/:id/toggle-codes - Toggle SKU code visibility
router.patch('/products/:id/toggle-codes', requireAuth, (req, res) => {
    const db = req.app.locals.db;
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

    db.prepare(`UPDATE products SET show_codes = 1 - show_codes, updated_at=datetime('now') WHERE id = ?`).run(req.params.id);
    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json(updated);
});

// POST /admin/products/:id/move - Move product up or down in display order
router.post('/products/:id/move', requireAuth, (req, res) => {
    const db = req.app.locals.db;
    const { direction, category } = req.body;
    const productId = parseInt(req.params.id);

    if (!['up', 'down'].includes(direction)) {
        return res.status(400).json({ error: 'direction debe ser "up" o "down"' });
    }

    const target = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!target) return res.status(404).json({ error: 'Producto no encontrado' });

    // Get ordered list (optionally filtered by category to move within that group)
    let listSql = 'SELECT id, display_order FROM products';
    const params = [];
    if (category && category !== 'todos') {
        listSql += ' WHERE category = ?';
        params.push(category);
    }
    listSql += ' ORDER BY display_order ASC, id ASC';
    const list = db.prepare(listSql).all(...params);

    const idx = list.findIndex(p => p.id === productId);
    if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado en esa categoría' });

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= list.length) {
        return res.json({ message: 'Sin movimiento (ya está en el extremo)', moved: false });
    }

    const neighbor = list[swapIdx];

    // Swap display_order
    const swap = db.transaction(() => {
        db.prepare('UPDATE products SET display_order = ? WHERE id = ?').run(neighbor.display_order, target.id);
        db.prepare('UPDATE products SET display_order = ? WHERE id = ?').run(target.display_order, neighbor.id);
    });
    swap();

    res.json({ message: 'Orden actualizado', moved: true });
});

// DELETE /admin/products/:id - Delete product
router.delete('/products/:id', requireAuth, (req, res) => {
    const db = req.app.locals.db;
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.json({ message: 'Producto eliminado', id: parseInt(req.params.id) });
});

module.exports = router;

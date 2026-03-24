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
    const { name, description, category, brand, image, clave_z, clave_scj, upc, price } = req.body;

    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });

    const result = db.prepare(`
        INSERT INTO products (name, description, category, brand, image, clave_z, clave_scj, upc, price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, description || '', category || '', brand || '', image || '', clave_z || '', clave_scj || '', upc || '', parseFloat(price) || 0);

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(product);
});

// PUT /admin/products/:id - Update product
router.put('/products/:id', requireAuth, (req, res) => {
    const db = req.app.locals.db;
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

    const { name, description, category, brand, image, clave_z, clave_scj, upc, price } = req.body;

    db.prepare(`
        UPDATE products SET name=?, description=?, category=?, brand=?, image=?, clave_z=?, clave_scj=?, upc=?, price=?, updated_at=datetime('now')
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
        req.params.id
    );

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json(updated);
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

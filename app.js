const express = require("express");
const mariadb = require('mariadb');
const session = require("express-session");
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const http = require('http');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const crypto = require('crypto');
require('dotenv').config();

// Variables de entorno obligatorias: si falta alguna, se para el arranque en vez de fallar en caliente.
const REQUIRED_ENV = ['DB_HOST', 'DB_USER', 'DB_PWD', 'DB_DB', 'DB_USER2', 'DB_PWD2', 'SESSION_SECRET'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
    console.error(`Faltan variables de entorno obligatorias: ${missingEnv.join(', ')}`);
    process.exit(1);
}

const app = express();

// Confía en la cabecera X-Forwarded-* del último salto: necesario para que
// express-rate-limit identifique bien la IP real (si no, lanza ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// en cuanto algo delante de la app añade esa cabecera, como hace el propio Docker Desktop
// en su reenvío de puertos). Es seguro porque el puerto solo se publica en 127.0.0.1
// (ver docker-compose.yml) y, más adelante, porque el reverse proxy será el único camino de entrada.
app.set('trust proxy', 1);

// Registra errores en stdout (para `docker logs`/journald) y, además, en "Errores.log"
// para cuando se ejecuta directamente en Windows sin Docker.
function logError(message) {
    const logMessage = `[${new Date().toISOString()}] ${message}`;
    console.error(logMessage);
    fs.appendFile('Errores.log', logMessage + '\n', (err) => {
        if (err) {
            console.error("No se pudo escribir en Errores.log:", err);
        }
    });
}

// Manejo global de excepciones no capturadas y rechazos no manejados
process.on('uncaughtException', (err) => {
    logError('Uncaught Exception: ' + err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
    logError('Unhandled Rejection: ' + reason);
});

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // 'unsafe-eval' es necesario porque Vue se carga sin paso de build y compila
            // las plantillas en el propio navegador (usa `new Function` internamente).
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:"],
            fontSrc: ["'self'", "https://cdn.jsdelivr.net", "data:"],
            connectSrc: ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: true,
}));

// Configuración de la sesión
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      // true por defecto: así se comporta en producción, detrás del reverse proxy con TLS.
      // Si pruebas en local sin proxy delante y no es vía "localhost" (p.ej. una IP de LAN),
      // los navegadores no admiten cookies Secure sobre HTTP plano: pon COOKIE_SECURE=false
      // temporalmente para esas pruebas.
      secure: process.env.COOKIE_SECURE !== 'false',
      maxAge: 1000 * 60 * 60 * 24 * 14
    }
}));

const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PWD,
    database: process.env.DB_DB,
    connectionLimit: process.env.DB_CONNECTION_LIMIT,
});

const poolLog = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER2,
    password: process.env.DB_PWD2,
    database: process.env.DB_DB,
    connectionLimit: process.env.DB_CONNECTION_LIMIT,
});

const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware para exigir sesión iniciada en rutas de datos (APIs). Para rutas de páginas
// (`/consultas`, `/registro`) se sigue usando la redirección a /login definida más abajo.
function requireLogin(req, res, next) {
    if (req.session.loggedin) {
        next();
    } else {
        res.status(401).json({ error: 'No autenticado' });
    }
}

// Como ahora también hay cuentas de clientes (no solo admin), las rutas de gestión
// (ver/editar todas las incidencias) exigen además el rol de administrador.
function requireAdmin(req, res, next) {
    if (req.session.loggedin && req.session.rol === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'No autorizado' });
    }
}

// Limita los intentos de login para dificultar la fuerza bruta (las contraseñas se comparan con bcrypt).
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de inicio de sesión. Inténtalo de nuevo más tarde.' }
});

// Limita los registros de cuenta nuevos para dificultar la creación masiva de cuentas.
const signupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados registros desde esta IP. Inténtalo de nuevo más tarde.' }
});

// Carpetas a las que tiene acceso el servidor express (solo recursos públicos:
// index.html, login.html, css, js, imgs). Las páginas protegidas viven en /private
// y solo se sirven a través de las rutas con requireLogin más abajo.
app.use(express.static(path.join(__dirname, 'cliente/')));

// Middleware para analizar el cuerpo de las solicitudes
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Ruta para manejar el envío del formulario. Funciona sin sesión iniciada (solicitud anónima);
// si el usuario está logueado, la incidencia queda asociada a su cuenta para que pueda
// consultar después si se ha resuelto.
app.post('/submit', async (req, res) => {
    const { name, requestType, description } = req.body;
    if (!name || !description || !['pelicula', 'fallo'].includes(requestType)) {
        return res.status(400).json({ error: 'Datos no válidos' });
    }
    try {
        const userId = req.session.loggedin ? req.session.userId : null;
        await guardaIncidencia({ name, requestType, description, userId });
        res.status(200).json({exito:'Formulario enviado con éxito'});
    } catch (err) {
        logError('Error en /submit: ' + err.stack);
        res.status(500).json({error:'Error al enviar el formulario'});
    }
});

// Ruta para manejar login (tanto administradores como clientes registrados)
app.post('/log', loginLimiter, async function (request, response) {
    let username = request.body.usuario;
    let password = request.body.password;
    if (username && password) {
        let connection;
        try {
            connection = await poolLog.getConnection();
            let resQuery = await connection.query('SELECT * FROM usuarios WHERE usuario = ?', [username]);

            const user = resQuery[0];
            const passwordMatches = user ? await bcrypt.compare(password, user.pass) : false;

            if (passwordMatches) {
                request.session.loggedin = true;
                request.session.username = username;
                request.session.userId = user.ID;
                request.session.rol = user.rol;
                if (request.body.recordar) {
                    request.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 días
                } else {
                    // Cookie de sesión: desaparece al cerrar el navegador, sin fecha de expiración fija.
                    request.session.cookie.expires = false;
                }
                response.status(200).json({ rol: user.rol });
            } else {
                response.status(401).json({error:'Incorrect Username and/or Password!'});
            }
        } catch (err) {
            logError('Error en /log: ' + err.stack);
            response.status(500).send('Error en el login');
        } finally {
            if (connection) connection.end();
            response.end();
        }
    } else {
        response.status(400).json({error:'Please enter Username and Password!'});
        response.end();
    }
});

// Registro de cuenta de cliente (no de administrador: los admins se dan de alta a mano en BD).
app.post('/signup', signupLimiter, async function (request, response) {
    const usuario = typeof request.body.usuario === 'string' ? request.body.usuario.trim() : '';
    const password = request.body.password;

    if (usuario.length < 3 || usuario.length > 50) {
        return response.status(400).json({ error: 'El usuario debe tener entre 3 y 50 caracteres' });
    }
    if (!password || password.length < 8) {
        return response.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    let connection;
    try {
        connection = await poolLog.getConnection();
        const existing = await connection.query('SELECT ID FROM usuarios WHERE usuario = ?', [usuario]);
        if (existing.length > 0) {
            return response.status(409).json({ error: 'Ese usuario ya existe' });
        }
        const hash = await bcrypt.hash(password, 10);
        await connection.query('INSERT INTO usuarios (usuario, pass, rol) VALUES (?, ?, ?)', [usuario, hash, 'cliente']);
        response.status(201).json({ mensaje: 'Cuenta creada' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return response.status(409).json({ error: 'Ese usuario ya existe' });
        }
        logError('Error en /signup: ' + err.stack);
        response.status(500).json({ error: 'Error al crear la cuenta' });
    } finally {
        if (connection) connection.end();
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.status(200).json({ mensaje: 'Sesión cerrada' });
    });
});

// Comprobación de salud para el HEALTHCHECK de Docker (no depende de la BD a propósito,
// para no marcar el contenedor como "unhealthy" por una BD lenta en vez de por el propio proceso).
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Exponer al cliente el estado de sesión (sin datos sensibles) para adaptar la navegación.
app.get('/api/session', (req, res) => {
    res.json({
        loggedin: !!req.session.loggedin,
        username: req.session.username || null,
        rol: req.session.rol || null,
    });
});

app.get("/registro", (req, res) => {
    if (req.session.loggedin && req.session.rol === 'admin') {
        res.sendFile(path.join(__dirname, 'private/registro.html'));
    } else {
        res.redirect('/login?next=/registro');
    }
});

app.get('/consultas', (req, res) => {
    if (req.session.loggedin && req.session.rol === 'admin') {
        res.sendFile(path.join(__dirname, 'private/consultas.html'));
    } else {
        res.redirect('/login?next=/consultas');
    }
});

app.get('/mis-solicitudes', (req, res) => {
    if (req.session.loggedin) {
        res.sendFile(path.join(__dirname, 'private/mis-solicitudes.html'));
    } else {
        res.redirect('/login?next=/mis-solicitudes');
    }
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'cliente/login.html'));
});

app.get('/registrarse', (req, res) => {
    res.sendFile(path.join(__dirname, 'cliente/registrarse.html'));
});

app.get('/api/mis-solicitudes', requireLogin, async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const rows = await connection.query('SELECT * FROM `pelis`.`form` WHERE UserID = ?', [req.session.userId]);
        res.send(rows);
    } catch (err) {
        logError('Error en /api/mis-solicitudes: ' + err.stack);
        res.status(500).send('Error al obtener tus solicitudes');
    } finally {
        if (connection) connection.end();
    }
});

// Ruta para manejar los datos enviados
app.post('/completar-consultas', requireAdmin, async (req, res) => {
    const { selectedItems } = req.body;

    if (selectedItems && typeof selectedItems === 'object') {
        try {
            await Promise.all(Object.entries(selectedItems).map(async ([key, value]) => {
                await updateConsulta(key, value);
            }));
            sendIncidencias(res);
        } catch (err) {
            logError('Error en /completar-consultas: ' + err.stack);
            res.status(500).json({ success: false, message: 'Error al completar consultas' });
        }
    } else {
        res.status(400).json({ success: false, message: 'Datos no válidos' });
    }
});

app.get('/api/items', requireAdmin, async (req, res) => {
    try {
        await sendIncidencias(res);
    } catch (err) {
        logError('Error en /api/items: ' + err.stack);
        res.status(500).send('Error al obtener incidencias');
    }
});

app.get('/api/registro', requireAdmin, async (req, res) => {
    try {
        await sendRegistro(res);
    } catch (err) {
        logError('Error en /api/registro: ' + err.stack);
        res.status(500).send('Error al obtener incidencias');
    }
});

// Comparación de tokens en tiempo constante para evitar timing attacks.
function tokenMatches(provided, expected) {
    const providedBuf = Buffer.from(String(provided || ''));
    const expectedBuf = Buffer.from(String(expected));
    if (providedBuf.length !== expectedBuf.length) {
        return false;
    }
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

function escapeXml(value) {
    return String(value ?? '').replace(/[<>&'"]/g, (c) => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
    }[c]));
}

const TIPO_LABEL = { pelicula: 'Película', serie: 'Serie', fallo: 'Incidencia' };

// Feed RSS de solicitudes/incidencias pendientes, pensado para widgets externos
// (p.ej. el widget RSS de Homarr) que no pueden autenticarse con la cookie de sesión.
// Se protege con un token compartido en la URL en vez de con /login porque Homarr
// pide el feed desde su propio backend, sin sesión de navegador.
app.get('/api/rss/pendientes', async (req, res) => {
    if (!process.env.RSS_TOKEN || !tokenMatches(req.query.token, process.env.RSS_TOKEN)) {
        return res.status(404).send('Not found');
    }
    let connection;
    try {
        connection = await pool.getConnection();
        const rows = await connection.query(
            'SELECT * FROM `pelis`.`form` WHERE Resuelto = 0 ORDER BY Fecha DESC LIMIT 50'
        );
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const items = rows.map((item) => {
            const tipoLabel = TIPO_LABEL[item.Tipo] || item.Tipo;
            const contenido = item.Nombre || item.Descripcion || '';
            const title = `${item.Usuario || 'Anónimo'} — ${tipoLabel}: ${contenido}`;
            const pubDate = item.Fecha ? new Date(item.Fecha).toUTCString() : new Date().toUTCString();
            return `<item>
  <title>${escapeXml(title)}</title>
  <description>${escapeXml(contenido)}</description>
  <link>${baseUrl}/consultas</link>
  <guid isPermaLink="false">incidenciasplex-${item.ID}</guid>
  <pubDate>${pubDate}</pubDate>
</item>`;
        }).join('\n');
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>IncidenciasPlex - Pendientes</title>
  <link>${baseUrl}</link>
  <description>Solicitudes e incidencias pendientes de resolver</description>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>`;
        res.set('Content-Type', 'application/rss+xml; charset=utf-8');
        res.send(xml);
    } catch (err) {
        logError('Error en /api/rss/pendientes: ' + err.stack);
        res.status(500).send('Error al generar el feed');
    } finally {
        if (connection) connection.end();
    }
});

// "Hace X min/h/d", en español, para la columna "Desde" de la tabla de pendientes.
function timeAgo(date) {
    if (!date) return '';
    const diffMin = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (diffMin < 1) return 'justo ahora';
    if (diffMin < 60) return `hace ${diffMin} min`;
    const diffHoras = Math.floor(diffMin / 60);
    if (diffHoras < 24) return `hace ${diffHoras} h`;
    const diffDias = Math.floor(diffHoras / 24);
    return `hace ${diffDias} d`;
}

// Misma protección por token que el feed RSS, pero en HTML con formato de tabla
// (para el widget "iframe" de Homarr en vez del widget "RSS"). Se autorefresca
// con <meta refresh> porque el widget iframe de Homarr no vuelve a pedir la URL
// por sí solo. Siempre imprime la cabecera de la tabla, incluso sin pendientes,
// para que el hueco en el dashboard no quede vacío/confuso.
app.get('/api/tabla-pendientes', async (req, res) => {
    if (!process.env.RSS_TOKEN || !tokenMatches(req.query.token, process.env.RSS_TOKEN)) {
        return res.status(404).send('Not found');
    }
    let connection;
    try {
        connection = await pool.getConnection();
        const rows = await connection.query(
            'SELECT * FROM `pelis`.`form` WHERE Resuelto = 0 ORDER BY Fecha DESC LIMIT 50'
        );
        const BADGE_CLASS = { pelicula: 'badge-pelicula', serie: 'badge-serie', fallo: 'badge-fallo' };
        const filas = rows.map((item) => {
            const tipoLabel = TIPO_LABEL[item.Tipo] || item.Tipo;
            const badgeClass = BADGE_CLASS[item.Tipo] || 'badge-otro';
            const contenido = item.Nombre || item.Descripcion || '';
            const nombre = item.Usuario || 'Anónimo';
            const fechaMs = item.Fecha ? new Date(item.Fecha).getTime() : 0;
            return `<tr data-nombre="${escapeXml(nombre.toLowerCase())}" data-tipo="${escapeXml(tipoLabel.toLowerCase())}" data-descripcion="${escapeXml(contenido.toLowerCase())}" data-fecha="${fechaMs}">
  <td>${escapeXml(nombre)}</td>
  <td><span class="badge ${badgeClass}">${escapeXml(tipoLabel)}</span></td>
  <td>${escapeXml(contenido)}</td>
  <td>${escapeXml(timeAgo(item.Fecha))}</td>
</tr>`;
        }).join('\n');
        const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="60">
<style>
  :root { color-scheme: dark; }
  html, body { background: transparent; height: 100%; }
  body {
    margin: 0; padding: 12px; box-sizing: border-box;
    font-family: -apple-system, system-ui, "Segoe UI", sans-serif;
    color: #e9ecef; font-size: 13px;
    display: flex;
  }
  .card {
    background: rgba(13, 15, 20, 0.78);
    backdrop-filter: blur(20px) saturate(140%);
    -webkit-backdrop-filter: blur(20px) saturate(140%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.04);
    flex: 1; min-width: 0;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .table-wrap { flex: 1; min-height: 0; overflow-y: auto; }
  .table-wrap::-webkit-scrollbar { width: 8px; }
  .table-wrap::-webkit-scrollbar-track { background: transparent; }
  .table-wrap::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
  th {
    position: sticky; top: 0;
    background: rgba(13, 15, 20, 0.95);
    color: #8b8d94; font-weight: 600; text-transform: uppercase;
    font-size: 10px; letter-spacing: .04em; cursor: pointer; user-select: none;
    white-space: nowrap;
  }
  th:hover { color: #e9ecef; }
  th .arrow { display: inline-block; width: 10px; opacity: .8; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover td { background: rgba(255, 255, 255, 0.04); }
  .badge {
    display: inline-block; padding: 2px 9px; border-radius: 999px;
    font-size: 11px; font-weight: 500; border: 1px solid transparent; white-space: nowrap;
  }
  .badge-pelicula { background: rgba(59, 130, 246, .22); color: #bfdbfe; border-color: rgba(96, 165, 250, .4); }
  .badge-serie { background: rgba(168, 85, 247, .22); color: #e9d5ff; border-color: rgba(192, 132, 252, .4); }
  .badge-fallo { background: rgba(248, 113, 113, .22); color: #fecaca; border-color: rgba(252, 165, 165, .4); }
  .badge-otro { background: rgba(148, 163, 184, .22); color: #e2e8f0; border-color: rgba(148, 163, 184, .4); }
</style>
</head>
<body>
<div class="card">
<div class="table-wrap">
<table>
  <thead>
    <tr>
      <th data-key="nombre">Nombre <span class="arrow"></span></th>
      <th data-key="tipo">Tipo <span class="arrow"></span></th>
      <th data-key="descripcion">Descripción <span class="arrow"></span></th>
      <th data-key="fecha">Desde <span class="arrow">▼</span></th>
    </tr>
  </thead>
  <tbody>
${filas}
  </tbody>
</table>
</div>
</div>
<script>
(function () {
  var STORAGE_KEY = 'incidenciasplex-tabla-sort';
  var tbody = document.querySelector('tbody');
  var headers = Array.prototype.slice.call(document.querySelectorAll('th[data-key]'));

  function loadSort() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveSort(key, dir) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ key: key, dir: dir })); } catch (e) {}
  }
  function applySort(key, dir) {
    var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    rows.sort(function (a, b) {
      var va = a.dataset[key] || '';
      var vb = b.dataset[key] || '';
      if (key === 'fecha') { va = Number(va); vb = Number(vb); }
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    rows.forEach(function (r) { tbody.appendChild(r); });
    headers.forEach(function (h) {
      var arrow = h.querySelector('.arrow');
      arrow.textContent = h.dataset.key === key ? (dir === 'asc' ? '▲' : '▼') : '';
    });
  }

  headers.forEach(function (h) {
    h.addEventListener('click', function () {
      var key = h.dataset.key;
      var current = loadSort();
      var dir = (current && current.key === key && current.dir === 'asc') ? 'desc' : 'asc';
      applySort(key, dir);
      saveSort(key, dir);
    });
  });

  var saved = loadSort();
  if (saved) applySort(saved.key, saved.dir);
})();
</script>
</body>
</html>`;
        // Helmet fija X-Frame-Options: SAMEORIGIN globalmente, lo que impediría que
        // Homarr (otro origen) incruste esta página en su widget iframe.
        res.removeHeader('X-Frame-Options');
        res.setHeader('Content-Security-Policy', "frame-ancestors *");
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        logError('Error en /api/tabla-pendientes: ' + err.stack);
        res.status(500).send('Error al generar la tabla');
    } finally {
        if (connection) connection.end();
    }
});

// Crea la cuenta admin inicial si no existe ninguna con ese usuario. Solo actúa si
// ADMIN_USER/ADMIN_PASSWORD están definidas (pensado para el primer arranque en un
// despliegue nuevo, p.ej. Docker con una BD recién creada); si ya existe, no hace nada.
async function seedAdminUser() {
    const adminUser = process.env.ADMIN_USER;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminUser || !adminPassword) {
        return;
    }
    let connection;
    try {
        connection = await poolLog.getConnection();
        const existing = await connection.query('SELECT ID FROM usuarios WHERE usuario = ?', [adminUser]);
        if (existing.length > 0) {
            return;
        }
        const hash = await bcrypt.hash(adminPassword, 10);
        await connection.query('INSERT INTO usuarios (usuario, pass, rol) VALUES (?, ?, ?)', [adminUser, hash, 'admin']);
        console.log(`Cuenta admin "${adminUser}" creada en el primer arranque.`);
    } catch (err) {
        logError('Error en seedAdminUser: ' + err.stack);
    } finally {
        if (connection) connection.end();
    }
}

// Servidor HTTP plano: el TLS lo termina el reverse proxy delante de la app,
// que reenvía aquí por HTTP dentro de la red interna.
let server;
(async () => {
    await seedAdminUser();
    server = http.createServer(app).listen(PORT, HOST, () => {
        console.log(`Servidor HTTP corriendo en http://${HOST}:${PORT}`);
    });
})();

// Apagado limpio: `docker stop` manda SIGTERM y espera antes de matar el proceso.
// Sin esto, las conexiones en curso se cortan de golpe y los pools de BD quedan colgando.
function shutdown(signal) {
    console.log(`${signal} recibido, cerrando servidor...`);
    if (!server) {
        // La señal llegó mientras aún se creaba la cuenta admin, antes de arrancar a escuchar.
        process.exit(0);
    }
    server.close(async () => {
        await Promise.all([pool.end(), poolLog.end()]);
        process.exit(0);
    });
    // Si algo no cierra a tiempo, no dejamos el contenedor colgado indefinidamente.
    setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function guardaIncidencia(data) {
    let connection;
    try {
        connection = await pool.getConnection();
        let resQuery = []
        if(data.requestType === "pelicula"){
            resQuery = await connection.query('INSERT INTO form (Usuario, Tipo, Nombre, UserID) VALUES (?,?,?,?)', [data.name, data.requestType, data.description, data.userId]);
        }
        else{
            resQuery = await connection.query('INSERT INTO form (Usuario, Tipo, Descripcion, UserID) VALUES (?,?,?,?)', [data.name, data.requestType, data.description, data.userId]);
        }
        if (resQuery.affectedRows !== 1) {
            logError("Error al guardar incidencia en DB");
        }
    } catch (err) {
        logError('Error en guardaIncidencia: ' + err.stack);
        throw err;
    } finally {
        if (connection) connection.end();
    }
}

async function updateConsulta(consulta, valor) {
    let connection;
    try {
        connection = await pool.getConnection();
        let nuevoValor = (valor === "1") ? 0 : 1;
        await connection.query('UPDATE form SET Resuelto = ? WHERE ID = ?', [nuevoValor, consulta]);
    } catch (err) {
        logError('Error en updateConsulta: ' + err.stack);
        throw err;
    } finally {
        if (connection) connection.end();
    }
}

async function sendIncidencias(res) {
    let connection;
    try {
        connection = await pool.getConnection();
        let incidencias = await connection.query('SELECT * FROM `pelis`.`form`');
        res.send(incidencias);
    } catch (err) {
        logError('Error en sendIncidencias: ' + err.stack);
        res.status(500).send('Error al obtener incidencias');
    } finally {
        if (connection) connection.end();
    }
}

async function sendRegistro(res) {
    let connection;
    try {
        connection = await pool.getConnection();
        let incidencias = await connection.query('SELECT * FROM `pelis`.`newmovies`');
        res.send(incidencias);
    } catch (err) {
        logError('Error en sendRegistro: ' + err.stack);
        res.status(500).send('Error al obtener incidencias');
    } finally {
        if (connection) connection.end();
    }
}

// Middleware para manejar errores en Express
app.use((err, req, res, next) => {
  logError('Error en Express: ' + err.stack);
  res.status(500).send('Ha ocurrido un error en el servidor.');
});

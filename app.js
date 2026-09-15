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
require('dotenv').config();

// Variables de entorno obligatorias: si falta alguna, se para el arranque en vez de fallar en caliente.
const REQUIRED_ENV = ['DB_HOST', 'DB_USER', 'DB_PWD', 'DB_DB', 'DB_USER2', 'DB_PWD2', 'SESSION_SECRET'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
    console.error(`Faltan variables de entorno obligatorias: ${missingEnv.join(', ')}`);
    process.exit(1);
}

const app = express();

// Solo confiar en las cabeceras X-Forwarded-* (IP real, proto) cuando de verdad hay un
// reverse proxy delante — si no, cualquiera podría falsificarlas directamente.
// Actívalo (TRUST_PROXY=1) cuando pongas el reverse proxy delante de la app.
if (process.env.TRUST_PROXY) {
    app.set('trust proxy', 1);
}

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
// Servidor HTTP plano: el TLS lo termina el reverse proxy delante de la app,
// que reenvía aquí por HTTP dentro de la red interna.
const server = http.createServer(app)
  .listen(PORT, HOST, () => {
      console.log(`Servidor HTTP corriendo en http://${HOST}:${PORT}`);
  });

// Apagado limpio: `docker stop` manda SIGTERM y espera antes de matar el proceso.
// Sin esto, las conexiones en curso se cortan de golpe y los pools de BD quedan colgando.
function shutdown(signal) {
    console.log(`${signal} recibido, cerrando servidor...`);
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
            resQuery = await connection.query('INSERT INTO Form (Usuario, Tipo, Nombre, UserID) VALUES (?,?,?,?)', [data.name, data.requestType, data.description, data.userId]);
        }
        else{
            resQuery = await connection.query('INSERT INTO Form (Usuario, Tipo, Descripcion, UserID) VALUES (?,?,?,?)', [data.name, data.requestType, data.description, data.userId]);
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
        await connection.query('UPDATE Form SET Resuelto = ? WHERE ID = ?', [nuevoValor, consulta]);
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

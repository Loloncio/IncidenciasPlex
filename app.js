const express = require("express");
const mariadb = require('mariadb');
const session = require("express-session");
const AsyncLock = require('async-lock');
const { exec } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
require('dotenv').config();

var lock = new AsyncLock();

/*
 * Creación del servidor express con los servidores de sockets.
 */
const app = express();

// Configurar la sesión
app.use(session({
    secret: 'TestServerIncidenciasPlexDeLaCruz', // Reemplaza con un secreto más seguro
    resave: false, // Guarda la sesión solo si hay cambios
    saveUninitialized: false, // No guarda sesiones vacías
    cookie: {
      secure: true, // Usar 'true' si estás en HTTPS
      maxAge: 1000 * 60 * 60 * 24 * 7 // 1 semana
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

const PORT = 3000;

/** Carpetas a las que tiene acceso el servidor express **/
app.use(express.static(__dirname + '/cliente/'))

// Middleware para analizar el cuerpo de las solicitudes
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Ruta para manejar el envío del formulario
app.post('/submit', (req, res) => {
    const formData = req.body;
    guardaIncidencia(formData);
    res.send('Formulario enviado con éxito');

});
// Ruta para manejar login
app.post('/log', async function (request, response){
    // Obtenemos datos del formulario
    let username = request.body.usuario;
    let password = request.body.password;

    if (username && password) {
        // Creamos la conexión con mariadb
        let connection = await poolLog.getConnection();
        try {
            // Consulta a la base de datos, la respuesta será una fila o ninguna.
            let res = await connection.query('SELECT * FROM usuarios WHERE usuario = ? AND pass = ?', [username, password]);

            if (res.length > 0) {
                // Guardamos en la sesión los datos del usuario
                request.session.loggedin = true;
                request.session.username = username;
                user = username;
                // Vamos a consultas
                response.redirect('/consultas');
            } else
                // Login fallido
                response.send('Incorrect Username and/or Password!');
        } finally {
            response.end();
            connection.end();
        }
    } else {
        response.send('Please enter Username and Password!');
        response.end();
    }
});
// Ruta para manejar los datos enviados
app.post('/completar-consultas', (req, res) => {
    const { selectedItems } = req.body;

    // Check if selectedItems is an object
    if (selectedItems && typeof selectedItems === 'object') {

        // Iterate over the keys in the object
        Object.entries(selectedItems).forEach(([key, value]) => {
            updateConsulta(key, value); // Pass key and value as separate arguments
        });

        sendIncidencias(res);
    } else {
        res.status(400).json({ success: false, message: 'Datos no válidos' });
    }
});

app.get("/login", (req, res) => {
    res.sendFile(__dirname + '/cliente/login.html')
})
app.get('/consultas', (req, res) => {
    // Página principal, control de misión, solo se muestra si se ha logueado previamente.
    if (req.session.loggedin) {
        //Para ver el usuario: req.session.username
        res.sendFile(__dirname + '/cliente/consultas.html')
    } else {
        // Muestra este mensaje si se intenta acceder sin loguearse antes.
        res.send('Please login to view this page!');
    }
})
app.get('/api/items', async (req, res) => {
    sendIncidencias(res);
});

// Opciones del servidor HTTPS
const options = {
    key: fs.readFileSync(path.join(__dirname, 'server.key')),
    cert: fs.readFileSync(path.join(__dirname, 'server.cert'))
};

// Creación del servidor HTTPS
https.createServer(options, app).listen(PORT, () => {
    console.log(`Servidor HTTPS corriendo en https://localhost:${PORT}`);
});

async function guardaIncidencia(data) {
    let connection = await pool.getConnection();
    try {
        // Guarda el error en la base de datos
        if (data.seasonNumber === '')
            temporadas = 0
        else temporadas = parseInt(data.seasonNumber)
        let res = await connection.query('insert into Form (Usuario, Tipo, Temporadas, Descripcion) VALUES(?,?,?,?)', [data.name, data.requestType, temporadas, data.description]);

        if (res.length < 0) {
            console.log("Error al guardar incidencia en DB");
        }
    } catch (err) {
        // Manejo adicional de errores de SQL si es necesario
        console.error(err);
    } finally {
        connection.end();
    }
}

async function updateConsulta(consulta, valor) {
    let connection = await pool.getConnection();
    try {
        let nuevoValor;
        if(valor==="1"){
            nuevoValor = 0;
        }else      
            nuevoValor = 1;
        await connection.query('UPDATE Form SET Resuelto = ? WHERE ID = ?', [nuevoValor, consulta]);
    } catch (err) {
        // Manejo adicional de errores de SQL si es necesario
        console.error(err);
    } finally {
        connection.end();
    }
}
async function sendIncidencias(res) {
    let connection = await pool.getConnection();
    try {
        
        let incidencias = await connection.query('SELECT * FROM `pelis`.`form`');

        if (res.length < 0) {
            console.log("Error al obtener incidencias");
            } 
        else{
            res.send(incidencias)
        }
    } catch (err) {
        console.error(err);
    } finally {
        connection.end();
    }
    
}
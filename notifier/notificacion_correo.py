"""Vigila la tabla `notificaciones` y envía un correo por cada fila nueva.

Pensado para correr en un contenedor de larga duración (ver docker-compose.yml):
- Sin dependencias de Windows (a diferencia de Scripts/NotificacionWindows.py, que
  usa win10toast/plyer para notificaciones de escritorio y no puede dockerizarse).
- Si algo falla de forma persistente (BD caída, credenciales SMTP inválidas...) el
  proceso termina con código de error y deja que la política `restart` de Docker lo
  reinicie con una conexión nueva, en vez de intentar reconectar a mano aquí.
"""
import logging
import os
import signal
import smtplib
import sys
import time
from email.mime.text import MIMEText

import mysql.connector
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("notificacion_correo")

SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
EMAIL_USER = os.environ.get("EMAIL_USER")
EMAIL_PASS = os.environ.get("EMAIL_PASS")
POLL_INTERVAL_SECONDS = int(os.environ.get("NOTIFY_POLL_INTERVAL", "3600"))

DB_CONFIG = {
    "host": os.environ.get("DB_HOST"),
    "user": os.environ.get("DB_USER"),
    "password": os.environ.get("DB_PWD"),
    "database": os.environ.get("DB_DB"),
    "charset": "utf8mb4",
    "collation": "utf8mb4_general_ci",
    "autocommit": True,
}

REQUIRED_ENV = ["DB_HOST", "DB_USER", "DB_PWD", "DB_DB", "EMAIL_USER", "EMAIL_PASS"]


def check_env():
    missing = [key for key in REQUIRED_ENV if not os.environ.get(key)]
    if missing:
        log.error("Faltan variables de entorno obligatorias: %s", ", ".join(missing))
        sys.exit(1)


def construir_mensaje(pelicula, incidencia):
    if (not incidencia or incidencia.strip() == "") and pelicula:
        return f"Nueva película: {pelicula}"
    if (not pelicula or pelicula.strip() == "") and incidencia:
        return f"Nueva incidencia: {incidencia}"
    return f"Notificación - Película: {pelicula} | Incidencia: {incidencia}"


def enviar_correo(cuerpo):
    message = MIMEText(cuerpo, "plain")
    message["Subject"] = "Nuevas solicitudes"
    message["From"] = EMAIL_USER
    message["To"] = EMAIL_USER
    with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=30) as server:
        server.starttls()
        server.login(EMAIL_USER, EMAIL_PASS)
        server.sendmail(EMAIL_USER, EMAIL_USER, message.as_string())


def procesar_notificaciones(cursor, conn):
    cursor.execute("SELECT * FROM notificaciones")
    filas = cursor.fetchall()
    for fila in filas:
        cuerpo = "Lista de nuevas películas solicitadas:\n" + construir_mensaje(
            fila.get("pelicula", ""), fila.get("incidencia", "")
        )
        enviar_correo(cuerpo)
        cursor.execute("DELETE FROM notificaciones WHERE ID = %s", (fila["ID"],))
        conn.commit()
        log.info("Notificación %s enviada y eliminada", fila["ID"])


def main():
    check_env()

    # `docker stop` manda SIGTERM; sin este handler Python lo ignora y el
    # contenedor tarda el timeout completo (y puede cortar un envío a medias).
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(0))

    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor(dictionary=True)
    log.info("Conectado a la base de datos. Comprobando notificaciones cada %ss.", POLL_INTERVAL_SECONDS)

    try:
        while True:
            procesar_notificaciones(cursor, conn)
            time.sleep(POLL_INTERVAL_SECONDS)
    except (KeyboardInterrupt, SystemExit):
        log.info("Terminando la monitorización...")
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    main()

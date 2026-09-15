import time
import os
import mysql.connector
from win10toast import ToastNotifier
from dotenv import load_dotenv
from pathlib import Path
from plyer import notification
from PIL import Image
import threading
import smtplib
from email.mime.text import MIMEText

dotenv_path = Path(__file__).resolve().parent.parent/ '.env'

image_path = Path(__file__).resolve().parent.parent/ 'cliente' / 'imgs' / 'PlexCruzIcon.ico'

# Carga el archivo .env
load_dotenv(dotenv_path=dotenv_path)

port = 587
smtp_server = "smtp.gmail.com"
login = os.environ.get("EMAIL_USER")
password = os.environ.get("EMAIL_PASS")
sender_email = os.environ.get("EMAIL_USER")
receiver_email = os.environ.get("EMAIL_USER")

# Configuración de la conexión a la base de datos
config = {
    'host': os.environ.get("DB_HOST"),
    'user': os.environ.get("DB_USER"),         # Reemplaza con tu usuario de MariaDB
    'password': os.environ.get("DB_PWD"),  # Reemplaza con tu contraseña
    'database': os.environ.get("DB_DB"),
    'charset': 'utf8mb4',
    'collation': 'utf8mb4_general_ci',
    'autocommit': True
}

# Conexión a la base de datos
conn = mysql.connector.connect(**config)
cursor = conn.cursor(dictionary=True)

def procesar_notificaciones():
    mensaje = """\
        Lista de nuevas películas solicitadas:
        """
    # Obtener todas las filas de la tabla notificaciones
    cursor.execute("SELECT * FROM notificaciones")
    filas = cursor.fetchall()
    for fila in filas:
        id_notif = fila['ID']
        pelicula = fila.get('pelicula', '')
        incidencia = fila.get('incidencia', '')

        # Determinar el tipo de notificación según los campos
        if (incidencia is None or incidencia.strip() == '') and pelicula:
            mensaje += f"Nueva película: {pelicula}"
        elif (pelicula is None or pelicula.strip() == '') and incidencia:
            mensaje += f"Nueva incidencia: {incidencia}"
        else:
            # Si ambos tienen datos o están vacíos, se puede ajustar el mensaje según la necesidad.
            mensaje += f"Notificación - Película: {pelicula} | Incidencia: {incidencia}"

        # Create MIMEText object
        message = MIMEText(mensaje, "plain")
        message["Subject"] = "Nuevas solicitudes"
        message["From"] = sender_email
        message["To"] = receiver_email

        # Mostrar la notificación en Windows
        with smtplib.SMTP(smtp_server, port) as server:
            server.starttls()  # Secure the connection
            server.login(login, password)
            server.sendmail(sender_email, receiver_email, message.as_string())
        # Eliminar la fila procesada
        cursor.execute("DELETE FROM notificaciones WHERE ID = %s", (id_notif,))
        conn.commit()

if __name__ == '__main__':
    try:
        while True:
            procesar_notificaciones()
            time.sleep(3600)
    except KeyboardInterrupt:
        print("Terminando la monitorización...")
    finally:
        cursor.close()
        conn.close()

import time
import os
import mysql.connector
from win10toast import ToastNotifier
from dotenv import load_dotenv
from pathlib import Path
from plyer import notification
from PIL import Image
import threading

dotenv_path = Path(__file__).resolve().parent.parent/ '.env'

image_path = Path(__file__).resolve().parent.parent/ 'cliente' / 'imgs' / 'PlexCruzIcon.ico'

# Carga el archivo .env
load_dotenv(dotenv_path=dotenv_path)

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

# Inicializar el notificador de Windows
notifier = ToastNotifier()

def mostrar_notificacion(titulo, mensaje, duracion=5):
    notifier.show_toast(titulo, mensaje, duration=duracion, threaded=True, icon_path=image_path)
    
def procesar_notificaciones():
    # Obtener todas las filas de la tabla notificaciones
    cursor.execute("SELECT * FROM notificaciones")
    filas = cursor.fetchall()
    for fila in filas:
        id_notif = fila['ID']
        pelicula = fila.get('pelicula', '')
        incidencia = fila.get('incidencia', '')

        # Determinar el tipo de notificación según los campos
        if (incidencia is None or incidencia.strip() == '') and pelicula:
            mensaje = f"Nueva película: {pelicula}"
        elif (pelicula is None or pelicula.strip() == '') and incidencia:
            mensaje = f"Nueva incidencia: {incidencia}"
        else:
            # Si ambos tienen datos o están vacíos, se puede ajustar el mensaje según la necesidad.
            mensaje = f"Notificación - Película: {pelicula} | Incidencia: {incidencia}"

        # Mostrar la notificación en Windows
        hilo_notif = threading.Thread(target=mostrar_notificacion, args=("Notificación de plex", mensaje, 999999999))
        hilo_notif.start()
        # Eliminar la fila procesada
        cursor.execute("DELETE FROM notificaciones WHERE ID = %s", (id_notif,))
        conn.commit()

if __name__ == '__main__':
    try:
        while True:
            procesar_notificaciones()
            time.sleep(5)
    except KeyboardInterrupt:
        print("Terminando la monitorización...")
    finally:
        cursor.close()
        conn.close()

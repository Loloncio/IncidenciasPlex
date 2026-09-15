# Ruta al entorno virtual
$env:VIRTUAL_ENV_PATH = "C:\Servicios\IncidenciasPlex\.venv"

# Activar el entorno virtual
& "$env:VIRTUAL_ENV_PATH\Scripts\Activate.ps1"

# Ejecutar el script Python
& "python" "C:\Servicios\IncidenciasPlex\Scripts\NotificacionWindows.py"

# Desactivar el entorno virtual
deactivate
#!/bin/bash
# Se ejecuta junto a 01-schema.sql en el primer arranque (docker-entrypoint-initdb.d).
# Crea los usuarios de aplicación con permisos mínimos (nada de admin/root para la app),
# usando las mismas credenciales que ya tenéis en .env (DB_USER/DB_PWD, DB_USER2/DB_PWD2).
set -euo pipefail

mysql -u root -p"${MARIADB_ROOT_PASSWORD}" <<-EOSQL
  -- Usuario "web": incidencias/solicitudes (tabla form), lectura del catálogo (newmovies)
  -- y limpieza de la cola de notificaciones (la usa también el servicio notifier).
  CREATE USER IF NOT EXISTS '${DB_USER}'@'%' IDENTIFIED BY '${DB_PWD}';
  GRANT SELECT, INSERT, UPDATE ON pelis.form TO '${DB_USER}'@'%';
  GRANT SELECT ON pelis.newmovies TO '${DB_USER}'@'%';
  GRANT SELECT, DELETE ON pelis.notificaciones TO '${DB_USER}'@'%';

  -- Usuario "usuarios": login y alta de cuentas (tabla usuarios) únicamente.
  CREATE USER IF NOT EXISTS '${DB_USER2}'@'%' IDENTIFIED BY '${DB_PWD2}';
  GRANT SELECT, INSERT ON pelis.usuarios TO '${DB_USER2}'@'%';

  FLUSH PRIVILEGES;
EOSQL

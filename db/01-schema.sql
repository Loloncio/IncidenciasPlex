-- Se ejecuta automáticamente una sola vez, al crear el volumen de datos de MariaDB
-- por primera vez (mecanismo estándar de la imagen oficial: docker-entrypoint-initdb.d).
-- Basado en el volcado de esquema (sin datos) proporcionado.

CREATE DATABASE IF NOT EXISTS `pelis` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `pelis`;

CREATE TABLE IF NOT EXISTS `usuarios` (
  `ID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `usuario` varchar(50) NOT NULL,
  `pass` varchar(255) NOT NULL,
  `rol` enum('admin','cliente') NOT NULL DEFAULT 'cliente',
  UNIQUE KEY `uq_usuarios_usuario` (`usuario`),
  UNIQUE KEY `uq_usuarios_id` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `form` (
  `ID` int(11) NOT NULL AUTO_INCREMENT,
  `Usuario` varchar(50) DEFAULT NULL,
  `Tipo` varchar(50) NOT NULL,
  `Nombre` varchar(75) DEFAULT NULL,
  `Descripcion` varchar(250) DEFAULT NULL,
  `Temporadas` int(11) DEFAULT 0,
  `Resuelto` tinyint(4) NOT NULL DEFAULT 0,
  `Fecha` datetime NOT NULL DEFAULT current_timestamp(),
  `UserID` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`ID`),
  KEY `fk_form_usuario` (`UserID`),
  CONSTRAINT `fk_form_usuario` FOREIGN KEY (`UserID`) REFERENCES `usuarios` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `newmovies` (
  `Id` int(1) NOT NULL AUTO_INCREMENT,
  `OriginalName` varchar(500) DEFAULT NULL,
  `NewName` varchar(100) DEFAULT NULL,
  `Animation` tinyint(4) DEFAULT NULL,
  `Result` tinyint(4) NOT NULL DEFAULT 0,
  `Fecha` datetime NOT NULL DEFAULT current_timestamp(),
  KEY `Id` (`Id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `notificaciones` (
  `ID` int(11) NOT NULL AUTO_INCREMENT,
  `pelicula` varchar(255) DEFAULT NULL,
  `incidencia` text DEFAULT NULL,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DELIMITER //
CREATE TRIGGER after_insert_form
AFTER INSERT ON form
FOR EACH ROW
BEGIN
  INSERT INTO notificaciones (pelicula, incidencia)
  VALUES (NEW.Nombre, NEW.Descripcion);
END//
DELIMITER ;

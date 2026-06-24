import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Les fichiers de log sont regroupés dans logs/ (déjà ignoré par git).
// On s'assure que le dossier existe : les transports File de Winston ne le créent pas.
const logDir = path.resolve(process.cwd(), 'logs');
fs.mkdirSync(logDir, { recursive: true });

// Format des fichiers : toujours JSON structuré + horodaté + stack des erreurs.
// Exploitable tel quel par un agrégateur (Datadog, Loki, ELK…).
const fileFormat = combine(timestamp(), errors({ stack: true }), json());

// Format console : JSON en prod (logs collectés par l'infra), lisible et coloré en dev.
const consoleFormat = isProduction
  ? fileFormat
  : combine(
      colorize(),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      errors({ stack: true }),
      printf(({ level, message, timestamp: ts, stack }) =>
        stack
          ? `${String(ts)} [${level}]: ${String(message)}\n${String(stack)}`
          : `${String(ts)} [${level}]: ${String(message)}`,
      ),
    );

export const logger = winston.createLogger({
  // npm levels : error(0) > warn(1) > info(2) > ... > debug(5).
  // En prod on retient à partir de info ; en dev on descend jusqu'à debug.
  level: isProduction ? 'info' : 'debug',
  // Format par défaut = format fichiers ; la console surcharge avec le sien.
  format: fileFormat,
  transports: [
    // Console : silencieuse en test pour ne pas polluer la sortie de Jest.
    new winston.transports.Console({ format: consoleFormat, silent: isTest }),
    // error.log : uniquement les erreurs.
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      silent: isTest,
    }),
    // combined.log : tout (selon le niveau global).
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      silent: isTest,
    }),
  ],
});

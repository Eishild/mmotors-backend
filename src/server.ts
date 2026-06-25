import 'dotenv/config';
// Importé immédiatement après dotenv (pour que SENTRY_DSN soit lu) et avant app :
// Sentry doit être initialisé avant le chargement d'Express/http.
import './instrument';
import app from './app';
import { logger } from './utils/logger';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV ?? 'development'} mode`);
});

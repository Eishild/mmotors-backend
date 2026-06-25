import * as Sentry from '@sentry/node';
import { env } from './config/env';

// Sentry.init() doit s'exécuter le plus tôt possible, AVANT l'import d'Express
// et du module http, pour que l'auto-instrumentation capture l'ensemble des
// requêtes ainsi que les exceptions non gérées / promesses rejetées.
//
// DSN absent (ex. dev/test) => le SDK reste inactif et n'envoie aucun event :
// l'application fonctionne normalement sans monitoring.
Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  enabled: Boolean(env.SENTRY_DSN),
});

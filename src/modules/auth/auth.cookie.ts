import { CookieOptions } from 'express';
import { env } from '../../config/env';

/** Nom du cookie httpOnly portant le JWT. */
export const TOKEN_COOKIE = 'token';

/** Durée de vie du cookie (24h), alignée sur l'expiration du JWT. */
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const isProduction = env.NODE_ENV === 'production';

/**
 * Options du cookie d'authentification.
 *
 * - httpOnly : inaccessible au JS du navigateur => protège contre le vol par XSS.
 * - secure / sameSite conditionnels selon l'environnement :
 *   - en production le front et l'API sont sur des domaines différents, donc
 *     sameSite 'none' (cookie cross-site) ce qui IMPOSE secure: true (HTTPS) —
 *     les navigateurs rejettent SameSite=None sans Secure.
 *   - en dev (http://localhost) secure: false (pas de HTTPS) et sameSite 'lax'
 *     suffit, c'est aussi plus permissif pour le développement.
 */
export const tokenCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: COOKIE_MAX_AGE_MS,
};

/**
 * Options pour effacer le cookie (logout). Doivent reproduire les mêmes
 * attributs que la pose (hors durée de vie), sinon le navigateur ne reconnaît
 * pas le cookie et ne le supprime pas.
 */
export const clearTokenCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
};

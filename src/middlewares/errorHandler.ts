import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  // Contexte commun joint à chaque log : permet de retrouver la requête fautive.
  const context = { method: req.method, url: req.originalUrl };

  if (err instanceof ZodError) {
    logger.warn(`Validation échouée: ${err.message}`, context);
    res.status(400).json({
      message: 'Données invalides',
      errors: err.flatten().fieldErrors,
    });
    return;
  }

  if (err instanceof AppError) {
    // Erreur applicative maîtrisée : warn pour le client (4xx), error pour le serveur (5xx).
    logger.log(err.statusCode >= 500 ? 'error' : 'warn', err.message, {
      ...context,
      statusCode: err.statusCode,
    });
    // On ne remonte à Sentry que les erreurs serveur (5xx), pas les 4xx clients.
    if (err.statusCode >= 500) {
      Sentry.captureException(err);
    }
    res.status(err.statusCode).json({ message: err.message });
    return;
  }

  // Erreurs multer (taille dépassée, champ inattendu…) : ce sont des erreurs
  // d'entrée client -> 400, message dédié pour le dépassement de taille.
  if (err instanceof MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (max 10 Mo)' : err.message;
    logger.warn(`Upload refusé: ${message}`, { ...context, code: err.code });
    res.status(400).json({ message });
    return;
  }

  // Erreur inattendue (500) : on logge le message + la stack complète côté serveur…
  logger.error(err.message, { ...context, stack: err.stack });

  // …et on la remonte à Sentry (erreur serveur non maîtrisée).
  Sentry.captureException(err);

  // …mais on ne renvoie jamais la stack au client en production.
  // En dev/test on l'expose pour faciliter le debug.
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    message: 'Internal server error',
    ...(isProduction ? {} : { error: err.message, stack: err.stack }),
  });
}

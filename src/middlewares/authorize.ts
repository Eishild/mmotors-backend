import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AppError } from './errorHandler';
import { AuthenticatedRequest } from '../types';

/**
 * Restreint l'accès aux rôles fournis. À chaîner APRÈS authenticate.
 * Renvoie 401 si non authentifié, 403 si le rôle ne fait pas partie des autorisés.
 *
 * Exemple : router.get('/dossiers', authenticate, authorize(Role.GESTIONNAIRE, Role.ADMIN), handler)
 */
export function authorize(...roles: Role[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, 'Authentification requise'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new AppError(403, 'Accès refusé'));
      return;
    }

    next();
  };
}

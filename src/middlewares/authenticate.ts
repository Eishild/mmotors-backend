import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from './errorHandler';
import { AuthenticatedRequest } from '../types';
import { JwtPayload } from '../modules/auth/auth.service';

/**
 * Vérifie le JWT du header Authorization (Bearer) et attache req.user.
 * Lève une 401 si le token est absent, mal formé ou invalide/expiré.
 */
export function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    next(new AppError(401, 'Token manquant'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch {
    next(new AppError(401, 'Token invalide ou expiré'));
  }
}

import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from './errorHandler';
import { AuthenticatedRequest } from '../types';
import { JwtPayload } from '../modules/auth/auth.service';

/**
 * Vérifie le JWT et attache req.user.
 *
 * Source du token, par ordre de priorité :
 *  1. cookie httpOnly `token` (flux navigateur sécurisé) ;
 *  2. header Authorization `Bearer <token>` (clients API / rétro-compatibilité).
 *
 * Lève une 401 si le token est absent, mal formé ou invalide/expiré.
 */
export function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const cookieToken = req.cookies?.token as string | undefined;
  const header = req.headers.authorization;

  let token: string | undefined;
  if (cookieToken) {
    token = cookieToken;
  } else if (header?.startsWith('Bearer ')) {
    token = header.slice('Bearer '.length).trim();
  }

  if (!token) {
    next(new AppError(401, 'Token manquant'));
    return;
  }

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

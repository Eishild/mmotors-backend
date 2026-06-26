import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AuthenticatedRequest } from '../types';
import { JwtPayload } from '../modules/auth/auth.service';

/**
 * Authentification « best effort » : attache req.user si un token valide est
 * présent (cookie httpOnly `token` ou header Bearer), mais ne bloque JAMAIS la
 * requête en cas d'absence ou d'invalidité.
 *
 * Utile pour les routes publiques dont le comportement s'enrichit lorsqu'un
 * utilisateur est connecté — ex. le listing des véhicules, qui expose le mode
 * back-office (`?scope=admin`) uniquement à un GESTIONNAIRE/ADMIN authentifié.
 *
 * Le contrôle de rôle reste à la charge du handler : ce middleware ne fait
 * qu'identifier l'appelant, il n'autorise rien.
 */
export function optionalAuthenticate(
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
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    // Token invalide/expiré : on ignore et on poursuit en visiteur anonyme.
  }

  next();
}

import { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { RegisterInput, LoginInput } from './auth.schema';
import { TOKEN_COOKIE, tokenCookieOptions, clearTokenCookieOptions } from './auth.cookie';
import { AuthenticatedRequest } from '../../types';

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.register(req.body as RegisterInput);
    // Le compte est immédiatement authentifié : on pose aussi le cookie httpOnly.
    res.cookie(TOKEN_COOKIE, result.token, tokenCookieOptions);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.login(req.body as LoginInput);
    // Token posé en cookie httpOnly (sécurisé) ET conservé dans le body pour la
    // rétro-compatibilité avec les clients qui utilisent le header Bearer.
    res.cookie(TOKEN_COOKIE, result.token, tokenCookieOptions);
    res.status(200).json({ data: result });
  } catch (error) {
    next(error);
  }
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(TOKEN_COOKIE, clearTokenCookieOptions);
  res.status(200).json({ message: 'Déconnexion réussie' });
}

/**
 * GET /auth/me — renvoie le profil de l'utilisateur authentifié.
 * authenticate a déjà validé le JWT et rempli req.user ; on relit la base pour
 * exposer le profil complet et à jour (le token ne porte que id/email/role).
 */
export async function me(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.getMe(req.user!.id);
    res.status(200).json({ data: user });
  } catch (error) {
    next(error);
  }
}

import { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { RegisterInput, LoginInput } from './auth.schema';
import { TOKEN_COOKIE, tokenCookieOptions, clearTokenCookieOptions } from './auth.cookie';

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

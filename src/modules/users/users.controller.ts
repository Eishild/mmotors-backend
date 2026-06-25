import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../types';
import {
  ChangePasswordInput,
  UpdateProfileInput,
  UpdateRoleInput,
  listUsersQuerySchema,
  userIdParamSchema,
} from './users.schema';
import * as usersService from './users.service';

/**
 * GET /users — liste paginée des comptes (ADMIN).
 * Query (role/pagination) parsée ici car elle nécessite coercition.
 */
export async function listUsers(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listUsersQuerySchema.parse(req.query);
    const result = await usersService.listUsers(query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /users/me — profil de l'utilisateur connecté. */
export async function getMe(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await usersService.getUserById(req.user!.id);
    res.status(200).json({ data: user });
  } catch (error) {
    next(error);
  }
}

/** PATCH /users/me — mise à jour de son propre profil. */
export async function updateProfile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await usersService.updateProfile(req.user!.id, req.body as UpdateProfileInput);
    res.status(200).json({ data: user });
  } catch (error) {
    next(error);
  }
}

/** PATCH /users/me/password — changement de son propre mot de passe. */
export async function changePassword(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await usersService.changePassword(req.user!.id, req.body as ChangePasswordInput);
    res.status(200).json({ message: 'Mot de passe mis à jour' });
  } catch (error) {
    next(error);
  }
}

/** GET /users/:id — consultation d'un compte par son id (ADMIN). */
export async function getUserById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = userIdParamSchema.parse(req.params.id);
    const user = await usersService.getUserById(id);
    res.status(200).json({ data: user });
  } catch (error) {
    next(error);
  }
}

/** PATCH /users/:id/role — changement de rôle d'un compte (ADMIN). */
export async function updateRole(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = userIdParamSchema.parse(req.params.id);
    const user = await usersService.updateRole(id, req.user!.id, req.body as UpdateRoleInput);
    res.status(200).json({ data: user });
  } catch (error) {
    next(error);
  }
}

/** DELETE /users/:id — suppression d'un compte (ADMIN). */
export async function deleteUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = userIdParamSchema.parse(req.params.id);
    await usersService.deleteUser(id, req.user!.id);
    res.status(200).json({ message: 'Utilisateur supprimé' });
  } catch (error) {
    next(error);
  }
}

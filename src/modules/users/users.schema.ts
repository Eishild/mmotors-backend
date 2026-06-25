import { z } from 'zod';
import { Role } from '@prisma/client';
import { passwordSchema } from '../auth/auth.schema';

/** Valide qu'un paramètre d'URL est bien un UUID (ex. :id d'utilisateur). */
export const userIdParamSchema = z.string().uuid('Identifiant utilisateur invalide');

/**
 * Query string de GET /users (back-office ADMIN).
 * Filtre optionnel par rôle + pagination, aligné sur les autres listes
 * (véhicules, dossiers) : coercition des nombres car tout arrive en chaîne.
 */
export const listUsersQuerySchema = z.object({
  role: z.nativeEnum(Role).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100, 'limit ne peut pas dépasser 100').default(20),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/**
 * Mise à jour de son propre profil (PATCH /users/me).
 *
 * - email, password et role NE sont PAS modifiables ici : l'email/mot de passe
 *   relèvent de flux dédiés (changement de mot de passe ci-dessous) et le rôle
 *   est une prérogative ADMIN.
 * - phone accepte `null` pour effacer le numéro ; au moins un champ requis.
 */
export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Le prénom est requis').optional(),
    lastName: z.string().trim().min(1, 'Le nom est requis').optional(),
    phone: z.string().trim().min(1).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Au moins un champ doit être fourni',
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Changement de son propre mot de passe (PATCH /users/me/password).
 * On exige le mot de passe courant (anti-détournement de session) et un nouveau
 * mot de passe respectant la même politique de robustesse qu'à l'inscription.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Le mot de passe actuel est requis'),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'Le nouveau mot de passe doit être différent de l\'actuel',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Changement du rôle d'un utilisateur (PATCH /users/:id/role, ADMIN).
 * Le rôle est la seule donnée modifiable par cet endpoint sensible.
 */
export const updateRoleSchema = z.object({
  role: z.nativeEnum(Role),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

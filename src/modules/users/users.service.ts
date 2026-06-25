import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middlewares/errorHandler';
import { SafeUser } from '../auth/auth.service';
import {
  ChangePasswordInput,
  ListUsersQuery,
  UpdateProfileInput,
  UpdateRoleInput,
} from './users.schema';

/** Coût bcrypt, aligné sur celui de l'inscription (auth.service). */
const BCRYPT_COST = 10;

/**
 * Sélection Prisma qui exclut explicitement le hash du mot de passe.
 * On ne renvoie JAMAIS `password` par l'API (cf. SafeUser dans auth.service).
 */
const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListUsersResult {
  data: SafeUser[];
  pagination: PaginationMeta;
}

/** Récupère un utilisateur (sans password) ou lève 404. Garde commune. */
async function findUserOrThrow(id: string): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { id }, select: safeUserSelect });
  if (!user) {
    throw new AppError(404, 'Utilisateur introuvable');
  }
  return user;
}

/**
 * Liste paginée des utilisateurs (back-office ADMIN), filtre optionnel par rôle.
 * Mirroir des autres listes : findMany + count en parallèle, password exclu.
 */
export async function listUsers(query: ListUsersQuery): Promise<ListUsersResult> {
  const { role, page, limit } = query;

  const where: Prisma.UserWhereInput = {};
  if (role) {
    where.role = role;
  }

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: safeUserSelect,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** Récupère un utilisateur par id (ADMIN), 404 si introuvable. */
export async function getUserById(id: string): Promise<SafeUser> {
  return findUserOrThrow(id);
}

/** Met à jour son propre profil (firstName / lastName / phone). */
export async function updateProfile(id: string, input: UpdateProfileInput): Promise<SafeUser> {
  return prisma.user.update({ where: { id }, data: input, select: safeUserSelect });
}

/**
 * Change le mot de passe de l'utilisateur courant.
 * Vérifie d'abord le mot de passe actuel (le hash n'est pas dans SafeUser, on
 * relit donc l'enregistrement complet), puis persiste le nouveau hash.
 */
export async function changePassword(id: string, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError(404, 'Utilisateur introuvable');
  }

  const matches = await bcrypt.compare(input.currentPassword, user.password);
  if (!matches) {
    throw new AppError(401, 'Mot de passe actuel incorrect');
  }

  const hashedPassword = await bcrypt.hash(input.newPassword, BCRYPT_COST);
  await prisma.user.update({ where: { id }, data: { password: hashedPassword } });
}

/**
 * Change le rôle d'un utilisateur (ADMIN).
 *
 * Garde-fou anti-verrouillage : un admin ne peut pas modifier son PROPRE rôle
 * (il risquerait de se retirer ses droits et de perdre l'accès au back-office).
 */
export async function updateRole(
  id: string,
  currentUserId: string,
  input: UpdateRoleInput,
): Promise<SafeUser> {
  if (id === currentUserId) {
    throw new AppError(403, 'Vous ne pouvez pas modifier votre propre rôle');
  }

  await findUserOrThrow(id);
  return prisma.user.update({ where: { id }, data: { role: input.role }, select: safeUserSelect });
}

/**
 * Supprime un utilisateur (ADMIN).
 *
 * - Anti-verrouillage : on n'autorise pas la suppression de son propre compte.
 * - Intégrité référentielle : un utilisateur lié à des dossiers ne peut pas être
 *   supprimé (FK Dossier.clientId) -> 409 explicite plutôt qu'une erreur Prisma.
 */
export async function deleteUser(id: string, currentUserId: string): Promise<void> {
  if (id === currentUserId) {
    throw new AppError(403, 'Vous ne pouvez pas supprimer votre propre compte');
  }

  await findUserOrThrow(id);

  const dossierCount = await prisma.dossier.count({ where: { clientId: id } });
  if (dossierCount > 0) {
    throw new AppError(
      409,
      `Impossible de supprimer : ${dossierCount} dossier(s) sont liés à cet utilisateur`,
    );
  }

  await prisma.user.delete({ where: { id } });
}

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Role, User } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/errorHandler';
import { RegisterInput, LoginInput } from './auth.schema';

const BCRYPT_COST = 10;
const JWT_EXPIRES_IN = '24h';

/** Payload signé dans le JWT. Volontairement minimal (pas de données sensibles). */
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

/** Utilisateur exposé à l'API : on retire systématiquement le champ password. */
export type SafeUser = Omit<User, 'password'>;

interface AuthResult {
  user: SafeUser;
  token: string;
}

function stripPassword(user: User): SafeUser {
  // On ne renvoie jamais le hash du mot de passe.
  const { password: _password, ...safe } = user;
  return safe;
}

function signToken(user: User): string {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, 'Un compte existe déjà avec cet email');
  }

  const hashedPassword = await bcrypt.hash(input.password, BCRYPT_COST);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      password: hashedPassword,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      // Le rôle n'est pas accepté à l'inscription : tout le monde démarre CLIENT.
      role: Role.CLIENT,
    },
  });

  return { user: stripPassword(user), token: signToken(user) };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Message générique + comparaison systématique pour ne pas révéler si l'email
  // existe et limiter les attaques par timing.
  const passwordMatches = user
    ? await bcrypt.compare(input.password, user.password)
    : await bcrypt.compare(input.password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');

  if (!user || !passwordMatches) {
    throw new AppError(401, 'Identifiants invalides');
  }

  return { user: stripPassword(user), token: signToken(user) };
}

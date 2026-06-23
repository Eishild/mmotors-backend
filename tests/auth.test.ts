import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { env } from '../src/config/env';
import { authenticate } from '../src/middlewares/authenticate';
import { authorize } from '../src/middlewares/authorize';
import { errorHandler } from '../src/middlewares/errorHandler';
import { logger } from '../src/utils/logger';
import { AuthenticatedRequest } from '../src/types';

// Préfixe unique pour isoler/nettoyer les utilisateurs créés par cette suite.
const TEST_EMAIL_DOMAIN = '@auth-test.local';

const validRegister = {
  email: `alice${TEST_EMAIL_DOMAIN}`,
  password: 'Str0ngPass',
  firstName: 'Alice',
  lastName: 'Martin',
};

async function cleanupTestUsers(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Endpoints register/login : nécessitent la base de test ────────────────────
// Le nettoyage DB est volontairement limité à ce bloc pour que les tests de
// middlewares (plus bas) restent exécutables sans connexion base.
describe('Auth endpoints (DB)', () => {
  beforeAll(cleanupTestUsers);
  afterEach(cleanupTestUsers);

  // ─── POST /api/v1/auth/register ──────────────────────────────────────────────

  describe('POST /api/v1/auth/register', () => {
    it('crée un compte et renvoie un token sans exposer le password (201)', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(validRegister);

      expect(res.status).toBe(201);
      expect(res.body.data.token).toEqual(expect.any(String));
      expect(res.body.data.user.email).toBe(validRegister.email);
      expect(res.body.data.user.role).toBe(Role.CLIENT);
      // Le hash du mot de passe ne doit jamais sortir de l'API.
      expect(res.body.data.user).not.toHaveProperty('password');

      // Le token est valide et porte le bon payload.
      const payload = jwt.verify(res.body.data.token, env.JWT_SECRET) as {
        email: string;
        role: Role;
      };
      expect(payload.email).toBe(validRegister.email);
      expect(payload.role).toBe(Role.CLIENT);
    });

    it('refuse un email déjà utilisé (409)', async () => {
      await request(app).post('/api/v1/auth/register').send(validRegister);
      const res = await request(app).post('/api/v1/auth/register').send(validRegister);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/existe déjà/i);
    });

    it('rejette une entrée invalide : mot de passe faible et email malformé (400)', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        email: 'not-an-email',
        password: 'weak',
        firstName: 'Bob',
        lastName: 'Dupont',
      });

      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveProperty('email');
      expect(res.body.errors).toHaveProperty('password');
    });
  });

  // ─── POST /api/v1/auth/login ───────────────────────────────────────────────────

  describe('POST /api/v1/auth/login', () => {
    const GENERIC_MESSAGE = 'Identifiants invalides';

    beforeEach(async () => {
      await request(app).post('/api/v1/auth/register').send(validRegister);
    });

    it('connecte un utilisateur avec les bons identifiants (200)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: validRegister.email, password: validRegister.password });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toEqual(expect.any(String));
      expect(res.body.data.user).not.toHaveProperty('password');
    });

    it('renvoie un message générique si le mot de passe est incorrect (401)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: validRegister.email, password: 'WrongPass123' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe(GENERIC_MESSAGE);
    });

    it("renvoie le MÊME message générique si l'email est inconnu (401)", async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: `ghost${TEST_EMAIL_DOMAIN}`, password: validRegister.password });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe(GENERIC_MESSAGE);
    });

    it('ne distingue pas mauvais mot de passe et email inexistant', async () => {
      const wrongPassword = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: validRegister.email, password: 'WrongPass123' });
      const unknownEmail = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: `ghost${TEST_EMAIL_DOMAIN}`, password: validRegister.password });

      expect(wrongPassword.status).toBe(unknownEmail.status);
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });
  });
}); // fin "Auth endpoints (DB)"

// ─── Middlewares authenticate / authorize ──────────────────────────────────────
// Mini-app dédiée : teste les middlewares en isolation, sans accès base de données.

describe('Middlewares authenticate & authorize', () => {
  const protectedApp = express();
  protectedApp.use(express.json());
  protectedApp.get('/me', authenticate, (req, res) => {
    res.json({ user: (req as AuthenticatedRequest).user });
  });
  protectedApp.get('/admin', authenticate, authorize(Role.ADMIN), (_req, res) => {
    res.json({ ok: true });
  });
  // authorize SANS authenticate → req.user indéfini (branche 401 de authorize).
  protectedApp.get('/no-auth', authorize(Role.ADMIN), (_req, res) => {
    res.json({ ok: true });
  });
  // Erreur inattendue (non-AppError) → branche 500 générique de errorHandler.
  protectedApp.get('/boom', (_req, _res, next) => {
    next(new Error('unexpected failure'));
  });
  protectedApp.use(errorHandler);

  const signToken = (role: Role): string =>
    jwt.sign({ sub: 'user-id', email: `u${TEST_EMAIL_DOMAIN}`, role }, env.JWT_SECRET, {
      expiresIn: '24h',
    });

  describe('authenticate', () => {
    it('accepte un token valide et attache req.user (200)', async () => {
      const res = await request(protectedApp)
        .get('/me')
        .set('Authorization', `Bearer ${signToken(Role.CLIENT)}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ id: 'user-id', role: Role.CLIENT });
    });

    it('refuse une requête sans token (401)', async () => {
      const res = await request(protectedApp).get('/me');
      expect(res.status).toBe(401);
    });

    it('refuse un token invalide (401)', async () => {
      const res = await request(protectedApp)
        .get('/me')
        .set('Authorization', 'Bearer not.a.real.token');
      expect(res.status).toBe(401);
    });
  });

  describe('authorize', () => {
    it('autorise le bon rôle (200)', async () => {
      const res = await request(protectedApp)
        .get('/admin')
        .set('Authorization', `Bearer ${signToken(Role.ADMIN)}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('refuse un rôle non autorisé (403)', async () => {
      const res = await request(protectedApp)
        .get('/admin')
        .set('Authorization', `Bearer ${signToken(Role.CLIENT)}`);
      expect(res.status).toBe(403);
    });

    it('renvoie 401 si appelé sans utilisateur authentifié', async () => {
      const res = await request(protectedApp).get('/no-auth');
      expect(res.status).toBe(401);
    });
  });

  describe('errorHandler', () => {
    it('mappe une erreur inattendue sur un 500 générique', async () => {
      // On réduit le bruit : winston logge l'erreur attendue.
      const spy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
      const res = await request(protectedApp).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Internal server error');
      spy.mockRestore();
    });
  });
});

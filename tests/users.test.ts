import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { DossierType, FuelType, PurchaseType, Role } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { env } from '../src/config/env';

/**
 * Tests d'intégration du module users (gestion des comptes).
 * Base réelle (.env.test) : jeu de données déterministe créé en beforeAll,
 * nettoyé en respectant l'ordre des FK (dossiers -> véhicules -> users).
 */

const TEST_EMAIL_DOMAIN = '@users-test.local';
const CLIENT_PASSWORD = 'Cli3ntPass';

const signToken = (id: string, role: Role): string =>
  jwt.sign({ sub: id, email: `${id}${TEST_EMAIL_DOMAIN}`, role }, env.JWT_SECRET, {
    expiresIn: '1h',
  });

let adminId: string;
let clientId: string; // client « simple » : profil + mot de passe modifiables
let dossierClientId: string; // client lié à un dossier (suppression interdite)
let adminToken: string;
let clientToken: string;
const createdVehicleIds: string[] = [];

async function cleanup(): Promise<void> {
  await prisma.dossierOption.deleteMany();
  await prisma.document.deleteMany();
  await prisma.dossier.deleteMany();
  await prisma.vehicle.deleteMany({ where: { id: { in: createdVehicleIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(async () => {
  await cleanup();

  const admin = await prisma.user.create({
    data: {
      email: `admin${TEST_EMAIL_DOMAIN}`,
      password: 'hashed',
      firstName: 'Admin',
      lastName: 'Root',
      role: Role.ADMIN,
    },
  });
  const client = await prisma.user.create({
    data: {
      email: `client${TEST_EMAIL_DOMAIN}`,
      password: await bcrypt.hash(CLIENT_PASSWORD, 10),
      firstName: 'Carla',
      lastName: 'Client',
      role: Role.CLIENT,
    },
  });
  const dossierClient = await prisma.user.create({
    data: {
      email: `withdossier${TEST_EMAIL_DOMAIN}`,
      password: 'hashed',
      firstName: 'Has',
      lastName: 'Dossier',
      role: Role.CLIENT,
    },
  });

  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'TestMotors',
      model: 'UserSpec',
      year: 2022,
      mileage: 10000,
      price: '18000.00',
      fuelType: FuelType.ESSENCE,
      purchaseType: PurchaseType.VENTE,
      images: [],
    },
  });
  createdVehicleIds.push(vehicle.id);

  await prisma.dossier.create({
    data: { type: DossierType.ACHAT, clientId: dossierClient.id, vehicleId: vehicle.id },
  });

  adminId = admin.id;
  clientId = client.id;
  dossierClientId = dossierClient.id;
  adminToken = signToken(adminId, Role.ADMIN);
  clientToken = signToken(clientId, Role.CLIENT);
}, 30000);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
}, 30000);

// ─── Espace personnel ───────────────────────────────────────────────────────────

describe('GET /api/v1/users/me', () => {
  it('renvoie le profil du client connecté sans password (200)', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(clientId);
    expect(res.body.data).not.toHaveProperty('password');
  });

  it('refuse une requête non authentifiée (401)', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/v1/users/me', () => {
  it('met à jour le profil et peut effacer le téléphone (200)', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ firstName: 'Caroline', phone: null });

    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe('Caroline');
    expect(res.body.data.phone).toBeNull();
  });

  it('rejette un corps vide (400)', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/v1/users/me/password', () => {
  it('refuse un mot de passe actuel incorrect (401)', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ currentPassword: 'WrongPass1', newPassword: 'N3wStrongPass' });

    expect(res.status).toBe(401);
  });

  it('rejette un nouveau mot de passe trop faible (400)', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ currentPassword: CLIENT_PASSWORD, newPassword: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('newPassword');
  });

  it('change le mot de passe et le hash persisté permet de se reconnecter (200)', async () => {
    const newPassword = 'N3wStrongPass';
    const res = await request(app)
      .patch('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ currentPassword: CLIENT_PASSWORD, newPassword });

    expect(res.status).toBe(200);

    // Le nouveau hash est bien actif : le login réussit avec le nouveau mot de passe.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `client${TEST_EMAIL_DOMAIN}`, password: newPassword });
    expect(login.status).toBe(200);

    // Remise en état pour les autres tests éventuels.
    await prisma.user.update({
      where: { id: clientId },
      data: { password: await bcrypt.hash(CLIENT_PASSWORD, 10) },
    });
  });
});

// ─── Administration (ADMIN) ─────────────────────────────────────────────────────

describe('GET /api/v1/users', () => {
  it('liste paginée des comptes pour un ADMIN, sans password (200)', async () => {
    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 20 });
    expect(res.body.data[0]).not.toHaveProperty('password');
  });

  it('filtre par rôle (200)', async () => {
    const res = await request(app)
      .get('/api/v1/users?role=ADMIN')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((u: { role: Role }) => u.role === Role.ADMIN)).toBe(true);
  });

  it('refuse un CLIENT (403)', async () => {
    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/users/:id', () => {
  it('renvoie un compte pour un ADMIN (200)', async () => {
    const res = await request(app)
      .get(`/api/v1/users/${clientId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(clientId);
  });

  it('rejette un id non-UUID (400)', async () => {
    const res = await request(app)
      .get('/api/v1/users/not-a-uuid')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('renvoie 404 pour un id UUID inexistant', async () => {
    const res = await request(app)
      .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/users/:id/role', () => {
  it('promeut un client en GESTIONNAIRE (200)', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${dossierClientId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: Role.GESTIONNAIRE });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe(Role.GESTIONNAIRE);

    // Remise en état.
    await prisma.user.update({ where: { id: dossierClientId }, data: { role: Role.CLIENT } });
  });

  it('empêche un ADMIN de modifier son propre rôle (403)', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${adminId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: Role.CLIENT });
    expect(res.status).toBe(403);
  });

  it('rejette un rôle invalide (400)', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${clientId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'SUPERUSER' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/users/:id', () => {
  it('empêche un ADMIN de supprimer son propre compte (403)', async () => {
    const res = await request(app)
      .delete(`/api/v1/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });

  it('refuse la suppression d\'un compte lié à des dossiers (409)', async () => {
    const res = await request(app)
      .delete(`/api/v1/users/${dossierClientId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });

  it('supprime un compte sans dossier (200)', async () => {
    const disposable = await prisma.user.create({
      data: {
        email: `disposable${TEST_EMAIL_DOMAIN}`,
        password: 'hashed',
        firstName: 'Temp',
        lastName: 'User',
        role: Role.CLIENT,
      },
    });

    const res = await request(app)
      .delete(`/api/v1/users/${disposable.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const stillThere = await prisma.user.findUnique({ where: { id: disposable.id } });
    expect(stillThere).toBeNull();
  });

  it('refuse un CLIENT (403)', async () => {
    const res = await request(app)
      .delete(`/api/v1/users/${clientId}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(403);
  });
});

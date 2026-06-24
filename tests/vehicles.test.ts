import request from 'supertest';
import jwt from 'jsonwebtoken';
import {
  DossierStatus,
  DossierType,
  FuelType,
  Prisma,
  PurchaseType,
  Role,
  Transmission,
  VehicleStatus,
} from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { env } from '../src/config/env';

/**
 * Tests d'intégration des routes publiques du catalogue (US-001 / US-002).
 *
 * Toutes les assertions reposent sur un jeu de données maîtrisé : on vide la
 * table Vehicle puis on insère un fixture déterministe, afin de pouvoir
 * raisonner sur des totaux exacts. La base de test est dédiée (.env.test).
 *
 * Plusieurs critères d'acceptation sont côté front (bouton "Réinitialiser",
 * clic, redirection vers le parcours dossier) : on teste ici leur contrat API
 * équivalent (cf. commentaires sur chaque bloc).
 */

const BASE = '/api/v1/vehicles';

// Fixture : 4 véhicules DISPONIBLE + 1 RESERVE (non visible publiquement).
const fixture: Prisma.VehicleCreateManyInput[] = [
  {
    brand: 'Renault',
    model: 'Clio',
    year: 2021,
    mileage: 45000,
    price: '12500.00',
    fuelType: FuelType.ESSENCE,
    transmission: Transmission.MANUELLE,
    color: 'Blanc',
    description: 'Citadine fiable',
    status: VehicleStatus.DISPONIBLE,
    purchaseType: PurchaseType.VENTE,
    images: ['https://placehold.co/600x400?text=Clio'],
  },
  {
    brand: 'Renault',
    model: 'Megane',
    year: 2020,
    mileage: 60000,
    price: '15000.00',
    fuelType: FuelType.DIESEL,
    transmission: Transmission.MANUELLE,
    color: 'Gris',
    status: VehicleStatus.DISPONIBLE,
    purchaseType: PurchaseType.VENTE,
    images: [],
  },
  {
    brand: 'Peugeot',
    model: '208',
    year: 2019,
    mileage: 80000,
    price: '9900.00',
    fuelType: FuelType.DIESEL,
    transmission: Transmission.MANUELLE,
    color: 'Noir',
    status: VehicleStatus.DISPONIBLE,
    purchaseType: PurchaseType.LOCATION,
    images: [],
  },
  {
    brand: 'Tesla',
    model: 'Model 3',
    year: 2022,
    mileage: 15000,
    price: '39900.00',
    fuelType: FuelType.ELECTRIQUE,
    transmission: Transmission.AUTOMATIQUE,
    color: 'Rouge',
    status: VehicleStatus.DISPONIBLE,
    purchaseType: PurchaseType.VENTE,
    images: ['https://placehold.co/600x400?text=Model+3'],
  },
  // Non disponible : ne doit jamais sortir dans la liste publique.
  {
    brand: 'Audi',
    model: 'A4',
    year: 2019,
    mileage: 95000,
    price: '21900.00',
    fuelType: FuelType.DIESEL,
    transmission: Transmission.AUTOMATIQUE,
    color: 'Noir',
    status: VehicleStatus.RESERVE,
    purchaseType: PurchaseType.VENTE,
    images: [],
  },
];

const AVAILABLE_COUNT = fixture.filter((v) => v.status === VehicleStatus.DISPONIBLE).length;

beforeAll(async () => {
  await prisma.vehicle.deleteMany();
  await prisma.vehicle.createMany({ data: fixture });
});

// Email marqueur pour isoler/nettoyer les utilisateurs créés par cette suite.
const TEST_EMAIL_DOMAIN = '@vehicles-test.local';

// Tokens signés directement : authenticate ne fait que vérifier le JWT et
// attacher req.user (pas de lookup DB), donc inutile de créer ces utilisateurs.
const signToken = (role: Role): string =>
  jwt.sign({ sub: `user-${role}`, email: `bo${TEST_EMAIL_DOMAIN}`, role }, env.JWT_SECRET, {
    expiresIn: '1h',
  });
const gestionnaireToken = signToken(Role.GESTIONNAIRE);
const clientToken = signToken(Role.CLIENT);

afterAll(async () => {
  // Ordre imposé par les FK : dossiers -> véhicules ; users en dernier.
  await prisma.dossier.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
  await prisma.$disconnect();
});

// ─── GET /api/v1/vehicles : liste & filtres ────────────────────────────────────

describe('GET /api/v1/vehicles', () => {
  // Critère "Réinitialiser" : sans filtre, le catalogue complet (disponible) revient.
  it('renvoie le catalogue complet des véhicules disponibles, sans les indisponibles', async () => {
    const res = await request(app).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(AVAILABLE_COUNT);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: 20,
      total: AVAILABLE_COUNT,
      totalPages: 1,
    });
    // Aucun véhicule non DISPONIBLE ne fuite (l'Audi RESERVE est exclue).
    expect(res.body.data.every((v: { status: string }) => v.status === 'DISPONIBLE')).toBe(true);
    expect(res.body.data.some((v: { brand: string }) => v.brand === 'Audi')).toBe(false);
  });

  // Critère "filtre marque" : la liste ne montre que la marque sélectionnée.
  it('filtre par marque (partiel, insensible à la casse)', async () => {
    const res = await request(app).get(BASE).query({ brand: 'reNau' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((v: { brand: string }) => v.brand === 'Renault')).toBe(true);
  });

  it('filtre par modèle (partiel, insensible à la casse)', async () => {
    const res = await request(app).get(BASE).query({ model: 'clio' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].model).toBe('Clio');
  });

  it('filtre par motorisation (fuelType, exact)', async () => {
    const res = await request(app).get(BASE).query({ fuelType: FuelType.ELECTRIQUE });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].brand).toBe('Tesla');
  });

  it('filtre par type d\'achat (purchaseType LOCATION)', async () => {
    const res = await request(app).get(BASE).query({ purchaseType: PurchaseType.LOCATION });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].purchaseType).toBe('LOCATION');
  });

  it('filtre par fourchette de prix (minPrice / maxPrice)', async () => {
    const res = await request(app).get(BASE).query({ minPrice: 10000, maxPrice: 20000 });

    expect(res.status).toBe(200);
    // Clio (12500) + Megane (15000) ; exclut Peugeot (9900) et Tesla (39900).
    expect(res.body.data).toHaveLength(2);
    const prices = res.body.data.map((v: { price: string }) => Number(v.price));
    expect(prices.every((p: number) => p >= 10000 && p <= 20000)).toBe(true);
  });

  it('filtre par kilométrage maximum (maxMileage)', async () => {
    const res = await request(app).get(BASE).query({ maxMileage: 50000 });

    // Clio (45000) + Tesla (15000).
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((v: { mileage: number }) => v.mileage <= 50000)).toBe(true);
  });

  it('combine plusieurs filtres (marque + motorisation)', async () => {
    const res = await request(app)
      .get(BASE)
      .query({ brand: 'renault', fuelType: FuelType.DIESEL });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].model).toBe('Megane');
  });

  // Critère "aucun résultat" : le backend renvoie une liste vide (total 0).
  // Le message "Aucun véhicule ne correspond à votre recherche" est affiché côté front.
  it('renvoie une liste vide quand aucun véhicule ne correspond', async () => {
    const res = await request(app).get(BASE).query({ brand: 'Ferrari' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.totalPages).toBe(0);
  });

  // ─── Pagination ──────────────────────────────────────────────────────────────

  it('pagine les résultats (page / limit) et calcule totalPages', async () => {
    const page1 = await request(app).get(BASE).query({ page: 1, limit: 2 });
    const page2 = await request(app).get(BASE).query({ page: 2, limit: 2 });

    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.pagination).toMatchObject({
      page: 1,
      limit: 2,
      total: AVAILABLE_COUNT,
      totalPages: Math.ceil(AVAILABLE_COUNT / 2),
    });

    expect(page2.body.data).toHaveLength(2);
    // Les pages ne se chevauchent pas.
    const ids1 = page1.body.data.map((v: { id: string }) => v.id);
    const ids2 = page2.body.data.map((v: { id: string }) => v.id);
    expect(ids1).not.toEqual(expect.arrayContaining(ids2));
  });

  // ─── Validation (Zod → 400) ────────────────────────────────────────────────────

  it('rejette une motorisation hors enum (400)', async () => {
    const res = await request(app).get(BASE).query({ fuelType: 'NUCLEAIRE' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('fuelType');
  });

  it('rejette un prix négatif (400)', async () => {
    const res = await request(app).get(BASE).query({ minPrice: -100 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('minPrice');
  });

  it('rejette minPrice > maxPrice (400)', async () => {
    const res = await request(app).get(BASE).query({ minPrice: 30000, maxPrice: 10000 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('minPrice');
  });

  it('rejette une limite de pagination trop grande (400)', async () => {
    const res = await request(app).get(BASE).query({ limit: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('limit');
  });
});

// ─── GET /api/v1/vehicles/:id : fiche détaillée ────────────────────────────────

describe('GET /api/v1/vehicles/:id', () => {
  // Critère "clic sur un véhicule" → accès à la fiche détaillée.
  it('renvoie la fiche détaillée d\'un véhicule existant (200)', async () => {
    const tesla = await prisma.vehicle.findFirstOrThrow({ where: { brand: 'Tesla' } });

    const res = await request(app).get(`${BASE}/${tesla.id}`);

    expect(res.status).toBe(200);

    // Critère "champs minimum de la fiche" : marque, modèle, année, kilométrage,
    // motorisation, prix, photos, statut (à vendre/à louer = purchaseType).
    const v = res.body.data;
    expect(v).toMatchObject({
      brand: 'Tesla',
      model: 'Model 3',
      year: 2022,
      mileage: 15000,
      fuelType: FuelType.ELECTRIQUE,
      purchaseType: PurchaseType.VENTE,
    });
    expect(Number(v.price)).toBe(39900);
    expect(Array.isArray(v.images)).toBe(true);

    // Critère "Déposer un dossier" : le backend expose l'id du véhicule, point
    // de départ du futur parcours de souscription (la redirection est côté front).
    expect(v.id).toBe(tesla.id);
  });

  it("renvoie 404 quand le véhicule n'existe pas", async () => {
    const res = await request(app).get(`${BASE}/00000000-0000-0000-0000-000000000000`);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/introuvable/i);
  });
});

// ─── Routes back-office (US-008 / US-009) ──────────────────────────────────────
// Ces tests s'exécutent APRÈS ceux de la liste (ordre source), donc les
// véhicules qu'ils créent/modifient n'affectent pas les totaux assertés plus haut.

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

const validCreateBody = {
  brand: 'Ford',
  model: 'Focus',
  year: 2021,
  mileage: 30000,
  price: 14000,
  fuelType: FuelType.ESSENCE,
  purchaseType: PurchaseType.VENTE,
  transmission: Transmission.MANUELLE,
  color: 'Bleu',
  images: ['https://placehold.co/600x400?text=Focus'],
};

// Helper : crée un véhicule via l'API (en gestionnaire) et renvoie sa ressource.
async function createVehicleViaApi(
  overrides: Partial<typeof validCreateBody> = {},
): Promise<{ id: string; purchaseType: string }> {
  const res = await request(app)
    .post(BASE)
    .set('Authorization', `Bearer ${gestionnaireToken}`)
    .send({ ...validCreateBody, ...overrides });
  expect(res.status).toBe(201);
  return res.body.data;
}

// ─── Protection des routes (authenticate + authorize) ──────────────────────────

describe('Protection des routes back-office', () => {
  it('refuse sans token (401)', async () => {
    const res = await request(app).post(BASE).send(validCreateBody);
    expect(res.status).toBe(401);
  });

  it('refuse un CLIENT (403)', async () => {
    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${clientToken}`)
      .send(validCreateBody);
    expect(res.status).toBe(403);
  });
});

// ─── POST /api/v1/vehicles ─────────────────────────────────────────────────────

describe('POST /api/v1/vehicles', () => {
  it('crée un véhicule (201) avec available=true par défaut', async () => {
    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send(validCreateBody);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ brand: 'Ford', model: 'Focus', available: true });
    expect(res.body.data.id).toEqual(expect.any(String));
  });

  it('rejette un corps invalide (400) : champs requis manquants / valeurs hors bornes', async () => {
    const res = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ brand: '', year: 1800, mileage: -5, price: 0, fuelType: 'PLASMA' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('brand');
    expect(res.body.errors).toHaveProperty('price');
    expect(res.body.errors).toHaveProperty('fuelType');
  });
});

// ─── PUT /api/v1/vehicles/:id ──────────────────────────────────────────────────

describe('PUT /api/v1/vehicles/:id', () => {
  it('met à jour un véhicule existant (200)', async () => {
    const created = await createVehicleViaApi();

    const res = await request(app)
      .put(`${BASE}/${created.id}`)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ price: 12000, color: 'Vert' });

    expect(res.status).toBe(200);
    expect(Number(res.body.data.price)).toBe(12000);
    expect(res.body.data.color).toBe('Vert');
  });

  it('renvoie 404 pour un véhicule inexistant', async () => {
    const res = await request(app)
      .put(`${BASE}/${UNKNOWN_ID}`)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ price: 9999 });

    expect(res.status).toBe(404);
  });

  it('rejette un corps vide (400) : au moins un champ requis', async () => {
    const created = await createVehicleViaApi();

    const res = await request(app)
      .put(`${BASE}/${created.id}`)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/v1/vehicles/:id (soft delete) ─────────────────────────────────

describe('DELETE /api/v1/vehicles/:id', () => {
  it('soft delete : bascule available=false et retire du catalogue public (200)', async () => {
    const created = await createVehicleViaApi();

    const del = await request(app)
      .delete(`${BASE}/${created.id}`)
      .set('Authorization', `Bearer ${gestionnaireToken}`);

    expect(del.status).toBe(200);
    expect(del.body.data.available).toBe(false);

    // La ligne existe toujours en base (préservation de l'historique)...
    const stillInDb = await prisma.vehicle.findUnique({ where: { id: created.id } });
    expect(stillInDb).not.toBeNull();

    // ...mais la fiche publique renvoie 404 et le véhicule n'est plus listé.
    const detail = await request(app).get(`${BASE}/${created.id}`);
    expect(detail.status).toBe(404);

    const list = await request(app).get(BASE).query({ brand: 'Ford' });
    expect(list.body.data.some((v: { id: string }) => v.id === created.id)).toBe(false);
  });

  it('renvoie 404 pour un véhicule inexistant', async () => {
    const res = await request(app)
      .delete(`${BASE}/${UNKNOWN_ID}`)
      .set('Authorization', `Bearer ${gestionnaireToken}`);

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/v1/vehicles/:id/status (bascule VENTE↔LOCATION) ─────────────────

describe('PATCH /api/v1/vehicles/:id/status', () => {
  it('bascule VENTE -> LOCATION puis LOCATION -> VENTE (200)', async () => {
    const created = await createVehicleViaApi({ purchaseType: PurchaseType.VENTE });

    const toLocation = await request(app)
      .patch(`${BASE}/${created.id}/status`)
      .set('Authorization', `Bearer ${gestionnaireToken}`);
    expect(toLocation.status).toBe(200);
    expect(toLocation.body.data.purchaseType).toBe(PurchaseType.LOCATION);

    const backToVente = await request(app)
      .patch(`${BASE}/${created.id}/status`)
      .set('Authorization', `Bearer ${gestionnaireToken}`);
    expect(backToVente.status).toBe(200);
    expect(backToVente.body.data.purchaseType).toBe(PurchaseType.VENTE);
  });

  it('renvoie 404 pour un véhicule inexistant', async () => {
    const res = await request(app)
      .patch(`${BASE}/${UNKNOWN_ID}/status`)
      .set('Authorization', `Bearer ${gestionnaireToken}`);

    expect(res.status).toBe(404);
  });

  it("refuse la bascule (409) si un dossier EN_COURS est lié au véhicule", async () => {
    const created = await createVehicleViaApi({ purchaseType: PurchaseType.LOCATION });

    // Dossier en cours d'instruction sur ce véhicule (nécessite un client réel).
    const client = await prisma.user.create({
      data: {
        email: `client${TEST_EMAIL_DOMAIN}`,
        password: 'hash',
        firstName: 'Test',
        lastName: 'Client',
        role: Role.CLIENT,
      },
    });
    await prisma.dossier.create({
      data: {
        type: DossierType.LOCATION,
        status: DossierStatus.EN_COURS,
        clientId: client.id,
        vehicleId: created.id,
      },
    });

    const res = await request(app)
      .patch(`${BASE}/${created.id}/status`)
      .set('Authorization', `Bearer ${gestionnaireToken}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/dossier/i);

    // Le type n'a pas changé.
    const unchanged = await prisma.vehicle.findUnique({ where: { id: created.id } });
    expect(unchanged?.purchaseType).toBe(PurchaseType.LOCATION);
  });
});

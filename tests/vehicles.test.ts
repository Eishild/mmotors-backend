import request from 'supertest';
import {
  FuelType,
  Prisma,
  PurchaseType,
  Transmission,
  VehicleStatus,
} from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/prisma';

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

afterAll(async () => {
  await prisma.vehicle.deleteMany();
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

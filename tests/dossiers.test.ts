import request from 'supertest';
import jwt from 'jsonwebtoken';
import {
  DossierType,
  PurchaseType,
  FuelType,
  OptionType,
  Role,
  VehicleStatus,
} from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { env } from '../src/config/env';

/**
 * Tests d'intégration de POST /api/v1/dossiers/:id/documents (US-005).
 *
 * On mocke le SERVICE storage (Supabase) : ces tests valident le câblage route
 * + multer + contrôle d'accès + persistance Prisma, SANS dépendre du réseau ni
 * d'un vrai bucket. Le mapping chemin/erreurs Supabase est couvert séparément
 * dans storage.test.ts.
 *
 * La base est réelle (.env.test) : on crée un jeu de données déterministe puis
 * on nettoie en respectant l'ordre des FK.
 */

const SIGNED_URL = 'https://signed.example/doc?token=abc';

jest.mock('../src/modules/dossiers/storage.service', () => ({
  uploadDocument: jest.fn(async (dossierId: string) => ({
    filePath: `${dossierId}/mocked-uuid.pdf`,
  })),
  getSignedUrl: jest.fn(async () => SIGNED_URL),
}));

const TEST_EMAIL_DOMAIN = '@dossiers-test.local';

const signToken = (id: string, role: Role): string =>
  jwt.sign({ sub: id, email: `${id}${TEST_EMAIL_DOMAIN}`, role }, env.JWT_SECRET, {
    expiresIn: '1h',
  });

// Identifiants partagés, renseignés dans beforeAll.
let ownerId: string;
let otherClientId: string;
let dossierId: string;
let ownerToken: string;
let otherClientToken: string;
let gestionnaireToken: string;
// Véhicules dédiés aux tests de création de dossier.
let venteVehicleId: string; // VENTE / DISPONIBLE
let locationVehicleId: string; // LOCATION / DISPONIBLE
let reservedVehicleId: string; // VENTE / RESERVE (non disponible)

// Tous les véhicules créés par cette suite (nettoyage par id en afterAll).
const createdVehicleIds: string[] = [];

const pdf = Buffer.from('%PDF-1.4 fake content');

const post = (id: string) =>
  request(app).post(`/api/v1/dossiers/${id}/documents`);

const baseVehicle = {
  brand: 'TestMotors',
  year: 2022,
  mileage: 10000,
  price: '18000.00',
  fuelType: FuelType.ESSENCE,
  images: [],
};

beforeAll(async () => {
  // Nettoyage préalable (au cas où un run précédent aurait laissé des restes).
  // Ordre imposé par les FK : options/documents -> dossiers -> users.
  await prisma.dossierOption.deleteMany();
  await prisma.document.deleteMany();
  await prisma.dossier.deleteMany();
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });

  const owner = await prisma.user.create({
    data: {
      email: `owner${TEST_EMAIL_DOMAIN}`,
      password: 'hashed',
      firstName: 'Owner',
      lastName: 'Client',
      role: Role.CLIENT,
    },
  });
  const other = await prisma.user.create({
    data: {
      email: `other${TEST_EMAIL_DOMAIN}`,
      password: 'hashed',
      firstName: 'Other',
      lastName: 'Client',
      role: Role.CLIENT,
    },
  });
  // Véhicule support du dossier utilisé par les tests d'upload.
  const docVehicle = await prisma.vehicle.create({
    data: { ...baseVehicle, model: 'Doc', purchaseType: PurchaseType.VENTE },
  });
  const vente = await prisma.vehicle.create({
    data: { ...baseVehicle, model: 'Vente', purchaseType: PurchaseType.VENTE },
  });
  const location = await prisma.vehicle.create({
    data: { ...baseVehicle, model: 'Location', purchaseType: PurchaseType.LOCATION },
  });
  const reserved = await prisma.vehicle.create({
    data: {
      ...baseVehicle,
      model: 'Reserved',
      purchaseType: PurchaseType.VENTE,
      status: VehicleStatus.RESERVE,
    },
  });
  createdVehicleIds.push(docVehicle.id, vente.id, location.id, reserved.id);

  const dossier = await prisma.dossier.create({
    data: { type: DossierType.ACHAT, clientId: owner.id, vehicleId: docVehicle.id },
  });

  ownerId = owner.id;
  otherClientId = other.id;
  dossierId = dossier.id;
  venteVehicleId = vente.id;
  locationVehicleId = location.id;
  reservedVehicleId = reserved.id;
  ownerToken = signToken(ownerId, Role.CLIENT);
  otherClientToken = signToken(otherClientId, Role.CLIENT);
  gestionnaireToken = signToken('gestionnaire-id', Role.GESTIONNAIRE);
}, 30000); // setup = plusieurs round-trips vers le pooler distant : 5s par défaut insuffisant.

afterAll(async () => {
  await prisma.dossierOption.deleteMany();
  await prisma.document.deleteMany();
  await prisma.dossier.deleteMany();
  await prisma.vehicle.deleteMany({ where: { id: { in: createdVehicleIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
  await prisma.$disconnect();
}, 30000);

describe('POST /api/v1/dossiers/:id/documents', () => {
  it('refuse l\'accès sans token (401)', async () => {
    const res = await post(dossierId).attach('document', pdf, {
      filename: 'cni.pdf',
      contentType: 'application/pdf',
    });
    expect(res.status).toBe(401);
  });

  it('permet au CLIENT propriétaire d\'uploader un PDF (201) et persiste le document', async () => {
    const res = await post(dossierId)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('document', pdf, { filename: 'cni.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'cni.pdf',
      mimeType: 'application/pdf',
      url: `${dossierId}/mocked-uuid.pdf`,
      signedUrl: SIGNED_URL,
      dossierId,
    });

    const inDb = await prisma.document.findUnique({ where: { id: res.body.data.id } });
    expect(inDb).not.toBeNull();
    expect(inDb?.url).toBe(`${dossierId}/mocked-uuid.pdf`);
  });

  it('permet à un GESTIONNAIRE d\'uploader (201)', async () => {
    const res = await post(dossierId)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .attach('document', pdf, { filename: 'justif.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
  });

  it('interdit à un autre CLIENT d\'uploader sur le dossier d\'autrui (403)', async () => {
    const res = await post(dossierId)
      .set('Authorization', `Bearer ${otherClientToken}`)
      .attach('document', pdf, { filename: 'cni.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
  });

  it('renvoie 404 pour un dossier inexistant', async () => {
    const res = await post('00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('document', pdf, { filename: 'cni.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(404);
  });

  it('renvoie 400 si l\'id de dossier n\'est pas un UUID', async () => {
    const res = await post('not-a-uuid')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('document', pdf, { filename: 'cni.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });

  it('renvoie 400 si aucun fichier n\'est fourni', async () => {
    const res = await post(dossierId).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it('rejette un type MIME non autorisé (400)', async () => {
    const res = await post(dossierId)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('document', Buffer.from('hello'), {
        filename: 'note.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
  });

  it('rejette un fichier de plus de 10 Mo (400)', async () => {
    // 10 Mo + 1 octet : déclenche la limite multer (MulterError LIMIT_FILE_SIZE),
    // mappée en 400 par le errorHandler.
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
    const res = await post(dossierId)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('document', tooBig, { filename: 'big.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/10 Mo/);
  });
});

describe('POST /api/v1/dossiers (création)', () => {
  const create = () => request(app).post('/api/v1/dossiers');

  it('refuse l\'accès sans token (401)', async () => {
    const res = await create().send({ vehicleId: venteVehicleId, type: DossierType.ACHAT });
    expect(res.status).toBe(401);
  });

  it('interdit la création à un GESTIONNAIRE (403)', async () => {
    const res = await create()
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ vehicleId: venteVehicleId, type: DossierType.ACHAT });
    expect(res.status).toBe(403);
  });

  it('crée un dossier ACHAT sur un véhicule en VENTE (201)', async () => {
    const res = await create()
      .set('Authorization', `Bearer ${otherClientToken}`)
      .send({ vehicleId: venteVehicleId, type: DossierType.ACHAT });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: DossierType.ACHAT,
      status: 'EN_ATTENTE_DOCUMENTS',
      clientId: otherClientId,
      vehicleId: venteVehicleId,
    });
    expect(res.body.data.options).toEqual([]);
  });

  it('crée un dossier LOCATION avec options et déduplique (201)', async () => {
    const res = await create()
      .set('Authorization', `Bearer ${otherClientToken}`)
      .send({
        vehicleId: locationVehicleId,
        type: DossierType.LOCATION,
        // Doublon volontaire : doit être dédupliqué.
        options: [
          OptionType.ASSURANCE_TOUS_RISQUES,
          OptionType.ASSISTANCE_DEPANNAGE,
          OptionType.ASSURANCE_TOUS_RISQUES,
        ],
      });

    expect(res.status).toBe(201);
    const types = res.body.data.options.map((o: { type: string }) => o.type).sort();
    expect(types).toEqual(
      [OptionType.ASSISTANCE_DEPANNAGE, OptionType.ASSURANCE_TOUS_RISQUES].sort(),
    );
  });

  it('refuse des options sur un dossier ACHAT (400)', async () => {
    const res = await create()
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        vehicleId: venteVehicleId,
        type: DossierType.ACHAT,
        options: [OptionType.ASSURANCE_TOUS_RISQUES],
      });

    expect(res.status).toBe(400);
  });

  it('refuse un type incohérent avec le mode du véhicule (409)', async () => {
    // Véhicule en VENTE -> un dossier LOCATION est incohérent.
    const res = await create()
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ vehicleId: venteVehicleId, type: DossierType.LOCATION });

    expect(res.status).toBe(409);
  });

  it('renvoie 404 pour un véhicule inexistant', async () => {
    const res = await create()
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ vehicleId: '00000000-0000-0000-0000-000000000000', type: DossierType.ACHAT });

    expect(res.status).toBe(404);
  });

  it('refuse un véhicule non disponible (409)', async () => {
    const res = await create()
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ vehicleId: reservedVehicleId, type: DossierType.ACHAT });

    expect(res.status).toBe(409);
  });

  it('refuse un second dossier actif sur le même véhicule (409)', async () => {
    // ownerToken n'a pas encore de dossier sur venteVehicleId : le 1er passe.
    const first = await create()
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ vehicleId: venteVehicleId, type: DossierType.ACHAT });
    expect(first.status).toBe(201);

    const second = await create()
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ vehicleId: venteVehicleId, type: DossierType.ACHAT });
    expect(second.status).toBe(409);
  });

  it('renvoie 400 si vehicleId n\'est pas un UUID', async () => {
    const res = await create()
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ vehicleId: 'not-a-uuid', type: DossierType.ACHAT });

    expect(res.status).toBe(400);
  });
});

import request from 'supertest';
import jwt from 'jsonwebtoken';
import {
  DossierStatus,
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

const post = (id: string) => request(app).post(`/api/v1/dossiers/${id}/documents`);

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
  it("refuse l'accès sans token (401)", async () => {
    const res = await post(dossierId).attach('document', pdf, {
      filename: 'cni.pdf',
      contentType: 'application/pdf',
    });
    expect(res.status).toBe(401);
  });

  it("permet au CLIENT propriétaire d'uploader un PDF (201) et persiste le document", async () => {
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

  it("permet à un GESTIONNAIRE d'uploader (201)", async () => {
    const res = await post(dossierId)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .attach('document', pdf, { filename: 'justif.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
  });

  it("interdit à un autre CLIENT d'uploader sur le dossier d'autrui (403)", async () => {
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

  it("renvoie 400 si l'id de dossier n'est pas un UUID", async () => {
    const res = await post('not-a-uuid')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('document', pdf, { filename: 'cni.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });

  it("renvoie 400 si aucun fichier n'est fourni", async () => {
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

  it("refuse l'accès sans token (401)", async () => {
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

  it("renvoie 400 si vehicleId n'est pas un UUID", async () => {
    const res = await create()
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ vehicleId: 'not-a-uuid', type: DossierType.ACHAT });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/dossiers/me (US-007)', () => {
  let meClientId: string;
  let meToken: string;

  beforeAll(async () => {
    const me = await prisma.user.create({
      data: {
        email: `me${TEST_EMAIL_DOMAIN}`,
        password: 'hashed',
        firstName: 'Me',
        lastName: 'Client',
        role: Role.CLIENT,
      },
    });
    meClientId = me.id;
    meToken = signToken(meClientId, Role.CLIENT);
    // Deux dossiers à ce client (création directe : on contourne les gardes de
    // l'endpoint, sans intérêt ici).
    await prisma.dossier.create({
      data: { type: DossierType.ACHAT, clientId: meClientId, vehicleId: venteVehicleId },
    });
    await prisma.dossier.create({
      data: { type: DossierType.LOCATION, clientId: meClientId, vehicleId: locationVehicleId },
    });
  }, 30000);

  it("refuse l'accès sans token (401)", async () => {
    const res = await request(app).get('/api/v1/dossiers/me');
    expect(res.status).toBe(401);
  });

  it('ne renvoie que les dossiers du client connecté, avec le véhicule', async () => {
    const res = await request(app)
      .get('/api/v1/dossiers/me')
      .set('Authorization', `Bearer ${meToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((d: { clientId: string }) => d.clientId === meClientId)).toBe(true);
    // Relation véhicule incluse pour le suivi…
    expect(res.body.data[0].vehicle).toMatchObject({ brand: 'TestMotors' });
    // …mais aucune fuite du chemin de stockage des documents (url absente).
    expect(res.body.data[0]).toHaveProperty('documents');
  });
});

describe('GET /api/v1/dossiers (US-010)', () => {
  const list = () => request(app).get('/api/v1/dossiers');

  it("refuse l'accès à un CLIENT (403)", async () => {
    const res = await list().set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });

  it('renvoie une liste paginée au GESTIONNAIRE', async () => {
    const res = await list().set('Authorization', `Bearer ${gestionnaireToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 20 });
    // Vue back-office : client + véhicule + nombre de documents.
    const sample = res.body.data[0];
    expect(sample.client).toBeDefined();
    expect(sample.vehicle).toBeDefined();
    expect(sample._count).toHaveProperty('documents');
  });

  it('filtre par statut', async () => {
    const res = await list()
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .query({ status: DossierStatus.EN_ATTENTE_DOCUMENTS });

    expect(res.status).toBe(200);
    expect(
      res.body.data.every(
        (d: { status: string }) => d.status === DossierStatus.EN_ATTENTE_DOCUMENTS,
      ),
    ).toBe(true);
  });

  it('filtre par type', async () => {
    const res = await list()
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .query({ type: DossierType.LOCATION });

    expect(res.status).toBe(200);
    expect(res.body.data.every((d: { type: string }) => d.type === DossierType.LOCATION)).toBe(
      true,
    );
  });

  it('renvoie 400 pour un statut invalide', async () => {
    const res = await list()
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .query({ status: 'PAS_UN_STATUT' });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/v1/dossiers/:id/status (US-011)', () => {
  const patch = (id: string) => request(app).patch(`/api/v1/dossiers/${id}/status`);
  let statusClientId: string;
  let freshDossierId: string;

  beforeAll(async () => {
    const c = await prisma.user.create({
      data: {
        email: `status${TEST_EMAIL_DOMAIN}`,
        password: 'hashed',
        firstName: 'Status',
        lastName: 'Client',
        role: Role.CLIENT,
      },
    });
    statusClientId = c.id;
  }, 30000);

  // Dossier neuf (EN_ATTENTE_DOCUMENTS) avant chaque test : les transitions
  // mutent l'état, on repart donc d'une base connue à chaque fois.
  beforeEach(async () => {
    const d = await prisma.dossier.create({
      data: { type: DossierType.ACHAT, clientId: statusClientId, vehicleId: venteVehicleId },
    });
    freshDossierId = d.id;
  }, 30000);

  it("refuse l'accès à un CLIENT (403)", async () => {
    const res = await patch(freshDossierId)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: DossierStatus.EN_COURS });
    expect(res.status).toBe(403);
  });

  it('passe EN_ATTENTE_DOCUMENTS → EN_COURS (200)', async () => {
    const res = await patch(freshDossierId)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ status: DossierStatus.EN_COURS });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(DossierStatus.EN_COURS);
  });

  it('refuse une transition invalide EN_ATTENTE_DOCUMENTS → VALIDE (409)', async () => {
    const res = await patch(freshDossierId)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ status: DossierStatus.VALIDE });

    expect(res.status).toBe(409);
  });

  it('refuse un REFUSE sans motif (400)', async () => {
    const res = await patch(freshDossierId)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ status: DossierStatus.REFUSE });

    expect(res.status).toBe(400);
  });

  it('refuse un motif sur un statut non-REFUSE (400)', async () => {
    const res = await patch(freshDossierId)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ status: DossierStatus.EN_COURS, refusalMotif: 'motif de trop' });

    expect(res.status).toBe(400);
  });

  it('refuse avec motif après mise en instruction et persiste le motif (200)', async () => {
    await patch(freshDossierId)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ status: DossierStatus.EN_COURS });

    const res = await patch(freshDossierId)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ status: DossierStatus.REFUSE, refusalMotif: 'Pièces illisibles' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(DossierStatus.REFUSE);
    expect(res.body.data.refusalMotif).toBe('Pièces illisibles');
  });

  it('renvoie 404 pour un dossier inexistant', async () => {
    const res = await patch('00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ status: DossierStatus.EN_COURS });

    expect(res.status).toBe(404);
  });

  it("renvoie 400 si l'id n'est pas un UUID", async () => {
    const res = await patch('not-a-uuid')
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ status: DossierStatus.EN_COURS });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/dossiers/:id/options (US-006)', () => {
  const options = (id: string) => request(app).post(`/api/v1/dossiers/${id}/options`);
  let optClientId: string;
  let optToken: string;
  let locationDossierId: string; // LOCATION, EN_ATTENTE_DOCUMENTS, à optClient
  let achatDossierId: string; // ACHAT (pour tester le rejet 409)
  let finalizedDossierId: string; // LOCATION mais VALIDE (rejet 409)

  beforeAll(async () => {
    const c = await prisma.user.create({
      data: {
        email: `options${TEST_EMAIL_DOMAIN}`,
        password: 'hashed',
        firstName: 'Opt',
        lastName: 'Client',
        role: Role.CLIENT,
      },
    });
    optClientId = c.id;
    optToken = signToken(optClientId, Role.CLIENT);

    const loc = await prisma.dossier.create({
      data: { type: DossierType.LOCATION, clientId: optClientId, vehicleId: locationVehicleId },
    });
    const achat = await prisma.dossier.create({
      data: { type: DossierType.ACHAT, clientId: optClientId, vehicleId: venteVehicleId },
    });
    const finalized = await prisma.dossier.create({
      data: {
        type: DossierType.LOCATION,
        clientId: optClientId,
        vehicleId: locationVehicleId,
        status: DossierStatus.VALIDE,
      },
    });
    locationDossierId = loc.id;
    achatDossierId = achat.id;
    finalizedDossierId = finalized.id;
  }, 30000);

  it("refuse l'accès sans token (401)", async () => {
    const res = await options(locationDossierId).send({
      options: [OptionType.ASSURANCE_TOUS_RISQUES],
    });
    expect(res.status).toBe(401);
  });

  it("interdit à un GESTIONNAIRE d'ajouter des options (403)", async () => {
    const res = await options(locationDossierId)
      .set('Authorization', `Bearer ${gestionnaireToken}`)
      .send({ options: [OptionType.ASSURANCE_TOUS_RISQUES] });
    expect(res.status).toBe(403);
  });

  it("interdit à un autre CLIENT d'ajouter des options au dossier d'autrui (403)", async () => {
    // ownerToken = client A, dossier appartient à optClient (client B).
    const res = await options(locationDossierId)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ options: [OptionType.ASSURANCE_TOUS_RISQUES] });
    expect(res.status).toBe(403);
  });

  it("permet au propriétaire d'ajouter des options et renvoie le détail tarifaire (201)", async () => {
    const res = await options(locationDossierId)
      .set('Authorization', `Bearer ${optToken}`)
      .send({
        options: [OptionType.ASSURANCE_TOUS_RISQUES, OptionType.ASSISTANCE_DEPANNAGE],
      });

    expect(res.status).toBe(201);
    const types = res.body.data.options.map((o: { type: string }) => o.type);
    expect(types).toContain(OptionType.ASSURANCE_TOUS_RISQUES);
    expect(types).toContain(OptionType.ASSISTANCE_DEPANNAGE);

    // Détail tarifaire : chaque option a un prix mensuel, et le total est leur somme.
    const priced = res.body.data.pricedOptions as {
      type: string;
      label: string;
      monthlyPrice: string;
    }[];
    const assurance = priced.find((o) => o.type === OptionType.ASSURANCE_TOUS_RISQUES);
    expect(assurance?.label).toEqual(expect.any(String));
    expect(Number(assurance?.monthlyPrice)).toBeCloseTo(49.9, 2);
    // 49.90 (assurance) + 9.90 (assistance) = 59.80 €/mois.
    expect(Number(res.body.data.monthlyOptionsTotal)).toBeCloseTo(59.8, 2);
  });

  it('est idempotent : ré-ajouter une option existante ne la duplique pas (201)', async () => {
    const res = await options(locationDossierId)
      .set('Authorization', `Bearer ${optToken}`)
      .send({ options: [OptionType.ASSURANCE_TOUS_RISQUES] });

    expect(res.status).toBe(201);
    const assurances = res.body.data.options.filter(
      (o: { type: string }) => o.type === OptionType.ASSURANCE_TOUS_RISQUES,
    );
    expect(assurances).toHaveLength(1);
  });

  it('refuse les options sur un dossier ACHAT (400)', async () => {
    const res = await options(achatDossierId)
      .set('Authorization', `Bearer ${optToken}`)
      .send({ options: [OptionType.ASSURANCE_TOUS_RISQUES] });
    expect(res.status).toBe(409);
  });

  it('refuse les options sur un dossier finalisé (409)', async () => {
    const res = await options(finalizedDossierId)
      .set('Authorization', `Bearer ${optToken}`)
      .send({ options: [OptionType.CONTROLE_TECHNIQUE] });
    expect(res.status).toBe(409);
  });

  it("refuse un tableau d'options vide (400)", async () => {
    const res = await options(locationDossierId)
      .set('Authorization', `Bearer ${optToken}`)
      .send({ options: [] });
    expect(res.status).toBe(400);
  });

  it('renvoie 404 pour un dossier inexistant', async () => {
    const res = await options('00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${optToken}`)
      .send({ options: [OptionType.ASSURANCE_TOUS_RISQUES] });
    expect(res.status).toBe(404);
  });

  it("renvoie 400 si l'id n'est pas un UUID", async () => {
    const res = await options('not-a-uuid')
      .set('Authorization', `Bearer ${optToken}`)
      .send({ options: [OptionType.ASSURANCE_TOUS_RISQUES] });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/v1/dossiers/options/catalog (US-006) ─────────────────────────────
describe('GET /api/v1/dossiers/options/catalog', () => {
  it('renvoie les 4 options avec libellé et prix mensuel positif (200, public)', async () => {
    // Pas d'en-tête d'auth : le catalogue tarifaire est public.
    const res = await request(app).get('/api/v1/dossiers/options/catalog');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(Object.keys(OptionType).length);

    const types = res.body.data.map((o: { type: string }) => o.type).sort();
    expect(types).toEqual([...Object.values(OptionType)].sort());

    for (const option of res.body.data as { label: string; monthlyPrice: string }[]) {
      expect(option.label).toEqual(expect.any(String));
      expect(Number(option.monthlyPrice)).toBeGreaterThan(0);
    }
  });

  it('trie les options par prix mensuel décroissant', async () => {
    const res = await request(app).get('/api/v1/dossiers/options/catalog');
    const prices = (res.body.data as { monthlyPrice: string }[]).map((o) => Number(o.monthlyPrice));
    const sortedDesc = [...prices].sort((a, b) => b - a);
    expect(prices).toEqual(sortedDesc);
  });
});

// ─── GET /api/v1/dossiers/:id (détail + documents) ─────────────────────────────

describe('GET /api/v1/dossiers/:id', () => {
  const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';
  let detailDossierId: string;
  let docId: string;

  beforeAll(async () => {
    const dossier = await prisma.dossier.create({
      data: { type: DossierType.ACHAT, clientId: ownerId, vehicleId: venteVehicleId },
    });
    detailDossierId = dossier.id;
    // Document inséré directement (le binaire/Storage est hors scope ici, mocké).
    const doc = await prisma.document.create({
      data: {
        name: 'piece-identite.pdf',
        url: `${dossier.id}/stored-uuid.pdf`, // chemin interne, ne doit pas fuiter
        mimeType: 'application/pdf',
        size: 12345,
        dossierId: dossier.id,
      },
    });
    docId = doc.id;
  }, 30000);

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { dossierId: detailDossierId } });
    await prisma.dossier.delete({ where: { id: detailDossierId } });
  });

  it("refuse l'accès sans token (401)", async () => {
    const res = await request(app).get(`/api/v1/dossiers/${detailDossierId}`);
    expect(res.status).toBe(401);
  });

  it('refuse un client non propriétaire (403)', async () => {
    const res = await request(app)
      .get(`/api/v1/dossiers/${detailDossierId}`)
      .set('Authorization', `Bearer ${otherClientToken}`);
    expect(res.status).toBe(403);
  });

  it('renvoie 404 pour un dossier inexistant', async () => {
    const res = await request(app)
      .get(`/api/v1/dossiers/${UNKNOWN_ID}`)
      .set('Authorization', `Bearer ${gestionnaireToken}`);
    expect(res.status).toBe(404);
  });

  it("renvoie 400 si l'id n'est pas un UUID", async () => {
    const res = await request(app)
      .get('/api/v1/dossiers/not-a-uuid')
      .set('Authorization', `Bearer ${gestionnaireToken}`);
    expect(res.status).toBe(400);
  });

  it('staff : renvoie le détail + documents avec URL signée, sans le chemin interne', async () => {
    const res = await request(app)
      .get(`/api/v1/dossiers/${detailDossierId}`)
      .set('Authorization', `Bearer ${gestionnaireToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(detailDossierId);
    expect(res.body.data.client).toMatchObject({ id: ownerId });
    expect(res.body.data.documents).toHaveLength(1);

    const doc = res.body.data.documents[0];
    expect(doc).toMatchObject({
      id: docId,
      name: 'piece-identite.pdf',
      mimeType: 'application/pdf',
      signedUrl: SIGNED_URL,
    });
    // Le chemin de stockage interne ne doit jamais être exposé.
    expect(doc.url).toBeUndefined();
  });

  it('propriétaire : peut ouvrir son propre dossier (200)', async () => {
    const res = await request(app)
      .get(`/api/v1/dossiers/${detailDossierId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.documents[0].signedUrl).toBe(SIGNED_URL);
  });
});

import {
  Document,
  DossierStatus,
  DossierType,
  Prisma,
  PurchaseType,
  Role,
  VehicleStatus,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middlewares/errorHandler';
import { AuthUser } from '../../types';
import {
  AddDossierOptionsInput,
  CreateDossierInput,
  ListDossiersQuery,
  UpdateDossierStatusInput,
} from './dossiers.schema';
import { getSignedUrl, uploadDocument } from './storage.service';

/** Statuts considérés comme "terminés" : un dossier dans cet état ne bloque pas un nouveau dépôt. */
const TERMINAL_STATUSES: DossierStatus[] = [DossierStatus.VALIDE, DossierStatus.REFUSE];

/**
 * Machine à états des dossiers (US-011). Transitions autorisées depuis chaque
 * statut, conformément au flux CLAUDE.md :
 *   EN_ATTENTE_DOCUMENTS → EN_COURS → (COMPLEMENT_DEMANDE) → VALIDE / REFUSE
 * VALIDE et REFUSE sont terminaux. COMPLEMENT_DEMANDE peut revenir en EN_COURS
 * (le client a fourni le complément) ou être tranché directement.
 */
const ALLOWED_TRANSITIONS: Record<DossierStatus, DossierStatus[]> = {
  [DossierStatus.EN_ATTENTE_DOCUMENTS]: [DossierStatus.EN_COURS],
  [DossierStatus.EN_COURS]: [
    DossierStatus.COMPLEMENT_DEMANDE,
    DossierStatus.VALIDE,
    DossierStatus.REFUSE,
  ],
  [DossierStatus.COMPLEMENT_DEMANDE]: [
    DossierStatus.EN_COURS,
    DossierStatus.VALIDE,
    DossierStatus.REFUSE,
  ],
  [DossierStatus.VALIDE]: [],
  [DossierStatus.REFUSE]: [],
};

/** Dossier renvoyé avec ses options (relation incluse). */
export type DossierWithOptions = Prisma.DossierGetPayload<{ include: { options: true } }>;

/** Document enrichi d'une URL signée fraîche (valable 60 s) pour accès immédiat. */
export interface DocumentWithSignedUrl extends Document {
  signedUrl: string;
}

/**
 * Garde d'accès : seuls le CLIENT propriétaire du dossier et les
 * GESTIONNAIRE/ADMIN peuvent y toucher. Les pièces (cartes d'identité, etc.)
 * sont sensibles — cf. CLAUDE.md, accès restreint au propriétaire et au back-office.
 *
 * On distingue volontairement 404 (dossier inexistant) de 403 (existe mais pas
 * le vôtre) : un client ne doit pas pouvoir sonder l'existence des dossiers
 * d'autrui, mais renvoyer 403 ici ne fuite rien de plus puisqu'il a fourni l'id.
 */
async function findDossierForUserOrThrow(dossierId: string, user: AuthUser): Promise<{ id: string }> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: { id: true, clientId: true },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier introuvable');
  }

  const isStaff = user.role === Role.GESTIONNAIRE || user.role === Role.ADMIN;
  const isOwner = dossier.clientId === user.id;

  if (!isStaff && !isOwner) {
    throw new AppError(403, 'Accès refusé à ce dossier');
  }

  return { id: dossier.id };
}

/**
 * Ajoute un document à un dossier (US-005).
 *
 * Flux : contrôle d'accès → upload du binaire vers Supabase Storage (bucket
 * privé) → persistance des métadonnées en base. On stocke dans `Document.url`
 * le CHEMIN de l'objet dans le bucket, pas une URL publique : le bucket étant
 * privé, l'accès se fait toujours via une URL signée éphémère générée à la
 * demande (les URLs signées de 60 s n'ont aucun intérêt à être persistées).
 */
export async function addDocumentToDossier(
  dossierId: string,
  user: AuthUser,
  file: Express.Multer.File,
): Promise<DocumentWithSignedUrl> {
  await findDossierForUserOrThrow(dossierId, user);

  const { filePath } = await uploadDocument(dossierId, file);

  const document = await prisma.document.create({
    data: {
      name: file.originalname,
      url: filePath,
      mimeType: file.mimetype,
      size: file.size,
      dossierId,
    },
  });

  // URL signée immédiate pour que le client puisse vérifier l'upload sans
  // re-solliciter l'API.
  const signedUrl = await getSignedUrl(filePath);

  return { ...document, signedUrl };
}

/** Type de dossier attendu selon le mode de commercialisation du véhicule. */
function expectedDossierType(purchaseType: PurchaseType): DossierType {
  return purchaseType === PurchaseType.VENTE ? DossierType.ACHAT : DossierType.LOCATION;
}

/**
 * Crée un dossier pour le client connecté (US-005 / US-006).
 *
 * `clientId` vient du JWT, jamais du corps : un client ne dépose que pour
 * lui-même. Gardes métier (les règles "options ⇔ LOCATION" sont déjà validées
 * par le schéma Zod) :
 *  - le véhicule doit exister et être commercialisable (non soft-deleted +
 *    statut DISPONIBLE) -> sinon 404 / 409 ;
 *  - le type de dossier doit correspondre au mode du véhicule (VENTE→ACHAT,
 *    LOCATION→LOCATION) -> 409 sinon, pour éviter un dossier incohérent ;
 *  - un seul dossier actif par (client, véhicule) : on refuse un doublon tant
 *    qu'un dossier non terminé existe -> 409.
 *
 * Le dossier et ses options sont créés dans une seule requête (create imbriqué)
 * pour rester atomique : pas de dossier orphelin sans ses options.
 */
export async function createDossier(
  clientId: string,
  input: CreateDossierInput,
): Promise<DossierWithOptions> {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: input.vehicleId, available: true },
  });

  if (!vehicle) {
    throw new AppError(404, 'Véhicule introuvable');
  }

  if (vehicle.status !== VehicleStatus.DISPONIBLE) {
    throw new AppError(409, 'Ce véhicule n\'est pas disponible pour un nouveau dossier');
  }

  const expectedType = expectedDossierType(vehicle.purchaseType);
  if (input.type !== expectedType) {
    throw new AppError(
      409,
      `Ce véhicule est proposé en ${vehicle.purchaseType} : seul un dossier de type ${expectedType} est possible`,
    );
  }

  const existingActive = await prisma.dossier.findFirst({
    where: {
      clientId,
      vehicleId: input.vehicleId,
      status: { notIn: TERMINAL_STATUSES },
    },
    select: { id: true },
  });

  if (existingActive) {
    throw new AppError(409, 'Un dossier est déjà en cours pour ce véhicule');
  }

  return prisma.dossier.create({
    data: {
      type: input.type,
      clientId,
      vehicleId: input.vehicleId,
      // Options uniquement en LOCATION (déjà garanti par le schéma) ; createMany
      // imbriqué crée les lignes DossierOption dans la même transaction.
      ...(input.options?.length
        ? { options: { createMany: { data: input.options.map((type) => ({ type })) } } }
        : {}),
    },
    include: { options: true },
  });
}

/**
 * Vue "suivi client" (US-007) : on n'expose ni les chemins de stockage internes
 * (Document.url) ni les données d'autres clients. Métadonnées des documents
 * seulement (nom/taille/date) — assez pour suivre l'avancement.
 */
const clientDossierInclude = {
  vehicle: { select: { id: true, brand: true, model: true, year: true, images: true } },
  options: { select: { type: true } },
  documents: { select: { id: true, name: true, mimeType: true, size: true, uploadedAt: true } },
} satisfies Prisma.DossierInclude;

/** Vue "back-office" (US-010) : client + véhicule + nombre de documents. */
const staffDossierInclude = {
  client: { select: { id: true, firstName: true, lastName: true, email: true } },
  vehicle: { select: { id: true, brand: true, model: true, year: true } },
  options: { select: { type: true } },
  _count: { select: { documents: true } },
} satisfies Prisma.DossierInclude;

/**
 * Vue "détail" d'un dossier (ouverture depuis le back-office US-010, ou par le
 * client propriétaire) : dossier complet + métadonnées des documents. On
 * sélectionne `url` (chemin de stockage interne) uniquement pour générer l'URL
 * signée ; il n'est jamais renvoyé tel quel.
 */
const dossierDetailInclude = {
  client: { select: { id: true, firstName: true, lastName: true, email: true } },
  vehicle: { select: { id: true, brand: true, model: true, year: true } },
  options: { select: { type: true } },
  documents: {
    select: { id: true, name: true, mimeType: true, size: true, uploadedAt: true, url: true },
    orderBy: { uploadedAt: 'asc' },
  },
} satisfies Prisma.DossierInclude;

export type ClientDossier = Prisma.DossierGetPayload<{ include: typeof clientDossierInclude }>;
export type StaffDossier = Prisma.DossierGetPayload<{ include: typeof staffDossierInclude }>;

/** Document exposé au front : métadonnées + URL signée éphémère (60 s). */
export interface DossierDocumentWithUrl {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  signedUrl: string;
}

/** Détail d'un dossier : comme la vue staff, mais avec les documents accessibles. */
export type DossierDetail = Omit<
  Prisma.DossierGetPayload<{ include: typeof dossierDetailInclude }>,
  'documents'
> & { documents: DossierDocumentWithUrl[] };

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListDossiersResult {
  data: StaffDossier[];
  pagination: PaginationMeta;
}

/**
 * Liste les dossiers du client connecté (US-007), du plus récent au plus ancien.
 * Filtrage par clientId : un client ne voit jamais que ses propres dossiers.
 */
export async function listMyDossiers(clientId: string): Promise<ClientDossier[]> {
  return prisma.dossier.findMany({
    where: { clientId },
    include: clientDossierInclude,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Liste paginée des dossiers pour le back-office (US-010), filtrable par statut
 * et type. Sert l'écran "dossiers à instruire" (le filtre status est appliqué
 * côté appelant). findMany + count en parallèle, même `where`.
 */
export async function listDossiers(query: ListDossiersQuery): Promise<ListDossiersResult> {
  const { status, type, page, limit } = query;

  const where: Prisma.DossierWhereInput = {
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
  };

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.dossier.findMany({
      where,
      include: staffDossierInclude,
      skip,
      take: limit,
      orderBy: { createdAt: 'asc' }, // file d'instruction : les plus anciens d'abord.
    }),
    prisma.dossier.count({ where }),
  ]);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

/**
 * Détail d'un dossier avec ses documents accessibles (ouverture depuis le
 * back-office, ou par le client propriétaire). L'accès est restreint au
 * propriétaire OU au staff (`findDossierForUserOrThrow` : 404 / 403). Chaque
 * pièce reçoit une URL signée fraîche (le bucket est privé) ; le chemin de
 * stockage interne (`url`) n'est jamais exposé.
 */
export async function getDossierDetailForUser(
  dossierId: string,
  user: AuthUser,
): Promise<DossierDetail> {
  await findDossierForUserOrThrow(dossierId, user);

  const dossier = await prisma.dossier.findUniqueOrThrow({
    where: { id: dossierId },
    include: dossierDetailInclude,
  });

  const documents = await Promise.all(
    dossier.documents.map(async ({ url, ...meta }) => ({
      ...meta,
      signedUrl: await getSignedUrl(url),
    })),
  );

  return { ...dossier, documents };
}

/**
 * Change le statut d'un dossier (US-011 : valider / refuser / demander complément).
 *
 * Gardes :
 *  - dossier inexistant -> 404 ;
 *  - transition interdite par la machine à états -> 409 ;
 *  - REFUSE sans motif déjà bloqué par le schéma Zod (400).
 *
 * `refusalMotif` n'est persisté que pour REFUSE ; pour tout autre statut on le
 * remet à null afin qu'un dossier rouvert ne traîne pas un ancien motif.
 */
export async function updateDossierStatus(
  id: string,
  input: UpdateDossierStatusInput,
): Promise<StaffDossier> {
  const dossier = await prisma.dossier.findUnique({ where: { id }, select: { status: true } });

  if (!dossier) {
    throw new AppError(404, 'Dossier introuvable');
  }

  if (!ALLOWED_TRANSITIONS[dossier.status].includes(input.status)) {
    throw new AppError(
      409,
      `Transition de statut invalide : ${dossier.status} → ${input.status}`,
    );
  }

  return prisma.dossier.update({
    where: { id },
    data: {
      status: input.status,
      refusalMotif: input.status === DossierStatus.REFUSE ? input.refusalMotif : null,
    },
    include: staffDossierInclude,
  });
}

/**
 * Ajoute des options à un dossier de location (US-006).
 *
 * Réservé au CLIENT propriétaire : un client A qui vise le dossier d'un client B
 * reçoit 403 (les options sont un choix personnel du locataire). Gardes :
 *  - dossier inexistant -> 404 ;
 *  - pas le propriétaire -> 403 ;
 *  - dossier non LOCATION -> 409 (les options ne concernent que la location) ;
 *  - dossier finalisé (VALIDE/REFUSE) -> 409 (ses options ne sont plus modifiables).
 *
 * createMany + skipDuplicates : ré-ajouter une option déjà présente est
 * idempotent (respecte @@unique([dossierId, type]) sans lever d'erreur).
 */
export async function addOptionsToDossier(
  dossierId: string,
  clientId: string,
  input: AddDossierOptionsInput,
): Promise<DossierWithOptions> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: { clientId: true, type: true, status: true },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier introuvable');
  }
  if (dossier.clientId !== clientId) {
    throw new AppError(403, 'Accès refusé à ce dossier');
  }
  if (dossier.type !== DossierType.LOCATION) {
    throw new AppError(409, 'Les options ne concernent que les dossiers de type LOCATION');
  }
  if (TERMINAL_STATUSES.includes(dossier.status)) {
    throw new AppError(409, 'Ce dossier est finalisé : ses options ne sont plus modifiables');
  }

  await prisma.dossierOption.createMany({
    data: input.options.map((type) => ({ dossierId, type })),
    skipDuplicates: true,
  });

  return prisma.dossier.findUniqueOrThrow({
    where: { id: dossierId },
    include: { options: true },
  });
}

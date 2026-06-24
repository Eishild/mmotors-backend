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
import { CreateDossierInput } from './dossiers.schema';
import { getSignedUrl, uploadDocument } from './storage.service';

/** Statuts considérés comme "terminés" : un dossier dans cet état ne bloque pas un nouveau dépôt. */
const TERMINAL_STATUSES: DossierStatus[] = [DossierStatus.VALIDE, DossierStatus.REFUSE];

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

import { DossierStatus, Prisma, PurchaseType, Vehicle, VehicleStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middlewares/errorHandler';
import { CreateVehicleInput, ListVehiclesQuery, UpdateVehicleInput } from './vehicles.schema';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListVehiclesResult {
  data: Vehicle[];
  pagination: PaginationMeta;
}

/**
 * Liste paginée des véhicules visibles publiquement.
 *
 * "Disponible" = status DISPONIBLE : le catalogue public ne montre pas les
 * véhicules vendus/loués/réservés. L'objet `where` Prisma est construit
 * dynamiquement : on n'ajoute un critère que si le filtre est réellement
 * présent dans la query string.
 */
export async function listVehicles(
  query: ListVehiclesQuery,
  admin = false,
): Promise<ListVehiclesResult> {
  const {
    brand,
    model,
    fuelType,
    purchaseType,
    minPrice,
    maxPrice,
    maxMileage,
    page,
    limit,
    status,
    available,
  } = query;

  // Public : non soft-deleted (available) ET commercialement libre (DISPONIBLE).
  // Back-office : tout le parc, avec filtres status/available facultatifs.
  const where: Prisma.VehicleWhereInput = admin
    ? {
        ...(status !== undefined ? { status } : {}),
        ...(available !== undefined ? { available } : {}),
      }
    : { available: true, status: VehicleStatus.DISPONIBLE };

  // Recherche partielle insensible à la casse sur la marque / le modèle.
  if (brand) {
    where.brand = { contains: brand, mode: 'insensitive' };
  }
  if (model) {
    where.model = { contains: model, mode: 'insensitive' };
  }

  // Correspondances exactes sur les enums.
  if (fuelType) {
    where.fuelType = fuelType;
  }
  if (purchaseType) {
    where.purchaseType = purchaseType;
  }

  // Fourchette de prix : on n'ajoute gte/lte que si la borne est fournie.
  if (minPrice !== undefined || maxPrice !== undefined) {
    where.price = {
      ...(minPrice !== undefined ? { gte: minPrice } : {}),
      ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
    };
  }

  // Kilométrage maximum.
  if (maxMileage !== undefined) {
    where.mileage = { lte: maxMileage };
  }

  const skip = (page - 1) * limit;

  // findMany + count en parallèle : même `where`, deux requêtes indépendantes.
  const [data, total] = await Promise.all([
    prisma.vehicle.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.vehicle.count({ where }),
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Récupère un véhicule visible publiquement (fiche détaillée, US-002).
 * Un véhicule soft-deleted (available=false) est considéré comme inexistant -> 404.
 */
export async function getVehicleById(id: string, includeUnavailable = false): Promise<Vehicle> {
  // Back-office (includeUnavailable) : on récupère le véhicule quel que soit son
  // état pour permettre son édition. Public : un véhicule retiré = 404.
  const vehicle = includeUnavailable
    ? await prisma.vehicle.findUnique({ where: { id } })
    : await prisma.vehicle.findFirst({ where: { id, available: true } });

  if (!vehicle) {
    throw new AppError(404, 'Véhicule introuvable');
  }

  return vehicle;
}

/**
 * Récupère un véhicule par id quel que soit son état (back-office), ou lève 404.
 * Sert de garde commune aux opérations d'écriture (update / delete / toggle).
 */
async function findVehicleOrThrow(id: string): Promise<Vehicle> {
  const vehicle = await prisma.vehicle.findUnique({ where: { id } });

  if (!vehicle) {
    throw new AppError(404, 'Véhicule introuvable');
  }

  return vehicle;
}

/** Création d'un véhicule (US-008). */
export async function createVehicle(input: CreateVehicleInput): Promise<Vehicle> {
  return prisma.vehicle.create({ data: input });
}

/** Mise à jour d'un véhicule, 404 si introuvable. */
export async function updateVehicle(id: string, input: UpdateVehicleInput): Promise<Vehicle> {
  await findVehicleOrThrow(id);
  return prisma.vehicle.update({ where: { id }, data: input });
}

/**
 * Soft delete : on ne supprime pas la ligne (les dossiers y font référence via
 * une FK), on bascule simplement available à false pour la retirer du catalogue.
 */
export async function softDeleteVehicle(id: string): Promise<Vehicle> {
  await findVehicleOrThrow(id);
  return prisma.vehicle.update({ where: { id }, data: { available: false } });
}

/**
 * Bascule le type d'achat VENTE↔LOCATION (US-009).
 * Garde-fou métier : on refuse la bascule si au moins un dossier EN_COURS est
 * lié au véhicule (changer le type sous un dossier en instruction le rendrait
 * incohérent) -> 409 avec un avertissement explicite.
 */
export async function toggleVehiclePurchaseType(id: string): Promise<Vehicle> {
  const vehicle = await findVehicleOrThrow(id);

  const ongoingDossiers = await prisma.dossier.count({
    where: { vehicleId: id, status: DossierStatus.EN_COURS },
  });

  if (ongoingDossiers > 0) {
    throw new AppError(
      409,
      `Impossible de changer le type : ${ongoingDossiers} dossier(s) en cours sont liés à ce véhicule`,
    );
  }

  const nextPurchaseType =
    vehicle.purchaseType === PurchaseType.VENTE ? PurchaseType.LOCATION : PurchaseType.VENTE;

  return prisma.vehicle.update({ where: { id }, data: { purchaseType: nextPurchaseType } });
}

import { Prisma, Vehicle, VehicleStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middlewares/errorHandler';
import { ListVehiclesQuery } from './vehicles.schema';

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
export async function listVehicles(query: ListVehiclesQuery): Promise<ListVehiclesResult> {
  const { brand, model, fuelType, purchaseType, minPrice, maxPrice, maxMileage, page, limit } =
    query;

  const where: Prisma.VehicleWhereInput = {
    status: VehicleStatus.DISPONIBLE,
  };

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

/** Récupère un véhicule par son id, ou lève une 404 s'il n'existe pas. */
export async function getVehicleById(id: string): Promise<Vehicle> {
  const vehicle = await prisma.vehicle.findUnique({ where: { id } });

  if (!vehicle) {
    throw new AppError(404, 'Véhicule introuvable');
  }

  return vehicle;
}

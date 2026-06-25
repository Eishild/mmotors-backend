import {
  PrismaClient,
  FuelType,
  Transmission,
  PurchaseType,
  VehicleStatus,
  Role,
  Prisma,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { logger } from '../src/utils/logger';

const prisma = new PrismaClient();

// Même coût bcrypt que l'inscription (auth.service.ts) pour rester cohérent.
const BCRYPT_COST = 10;

/**
 * Comptes de démonstration : un CLIENT et un GESTIONNAIRE.
 *
 * Mots de passe en clair UNIQUEMENT ici pour faciliter les tests manuels ;
 * ils sont hashés bcrypt avant insertion. Identifiants à NE PAS utiliser en prod.
 */
const users: Array<{
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: Role;
}> = [
  {
    email: 'client@mmotors.dev',
    password: 'Client123!',
    firstName: 'Camille',
    lastName: 'Client',
    phone: '0600000001',
    role: Role.CLIENT,
  },
  {
    email: 'gestionnaire@mmotors.dev',
    password: 'Gestion123!',
    firstName: 'Gaël',
    lastName: 'Gestionnaire',
    phone: '0600000002',
    role: Role.GESTIONNAIRE,
  },
];

async function seedUsers(): Promise<void> {
  for (const user of users) {
    const password = await bcrypt.hash(user.password, BCRYPT_COST);
    // Upsert sur l'email (unique) : idempotent et sans casser les dossiers liés.
    await prisma.user.upsert({
      where: { email: user.email },
      update: { password, firstName: user.firstName, lastName: user.lastName, phone: user.phone, role: user.role },
      create: {
        email: user.email,
        password,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
      },
    });
    logger.info(`Compte ${user.role} prêt : ${user.email}`);
  }
}

/**
 * Jeu de données de démonstration pour le catalogue véhicules.
 *
 * Volontairement varié pour exercer tous les filtres de GET /api/v1/vehicles :
 * - marques / modèles différents (recherche partielle insensible à la casse)
 * - les 4 motorisations (fuelType)
 * - VENTE et LOCATION (purchaseType)
 * - fourchettes de prix et de kilométrage étalées
 * - quelques véhicules NON disponibles (VENDU / LOUE / RESERVE) qui ne doivent
 *   PAS apparaître dans la liste publique.
 */
const vehicles: Prisma.VehicleCreateManyInput[] = [
  {
    brand: 'Renault',
    model: 'Clio',
    year: 2021,
    mileage: 45000,
    price: '12500.00',
    fuelType: FuelType.ESSENCE,
    transmission: Transmission.MANUELLE,
    color: 'Blanc',
    description: 'Citadine fiable, entretien à jour.',
    status: VehicleStatus.DISPONIBLE,
    purchaseType: PurchaseType.VENTE,
    images: ['https://placehold.co/600x400?text=Clio'],
  },
  {
    brand: 'Peugeot',
    model: '208',
    year: 2019,
    mileage: 80000,
    price: '9900.00',
    fuelType: FuelType.DIESEL,
    transmission: Transmission.MANUELLE,
    color: 'Gris',
    description: 'Diesel économique, idéale grands trajets.',
    status: VehicleStatus.DISPONIBLE,
    purchaseType: PurchaseType.VENTE,
    images: ['https://placehold.co/600x400?text=208'],
  },
  {
    brand: 'Tesla',
    model: 'Model 3',
    year: 2022,
    mileage: 15000,
    price: '39900.00',
    fuelType: FuelType.ELECTRIQUE,
    transmission: Transmission.AUTOMATIQUE,
    color: 'Noir',
    description: 'Autonomie longue durée, Autopilot.',
    status: VehicleStatus.DISPONIBLE,
    purchaseType: PurchaseType.VENTE,
    images: ['https://placehold.co/600x400?text=Model+3'],
  },
  {
    brand: 'Toyota',
    model: 'Yaris',
    year: 2021,
    mileage: 30000,
    price: '18500.00',
    fuelType: FuelType.HYBRIDE,
    transmission: Transmission.AUTOMATIQUE,
    color: 'Rouge',
    description: 'Hybride sobre, parfaite en ville.',
    status: VehicleStatus.DISPONIBLE,
    purchaseType: PurchaseType.LOCATION,
    images: ['https://placehold.co/600x400?text=Yaris'],
  },
  {
    brand: 'BMW',
    model: 'Série 3',
    year: 2020,
    mileage: 60000,
    price: '27500.00',
    fuelType: FuelType.DIESEL,
    transmission: Transmission.AUTOMATIQUE,
    color: 'Bleu',
    description: 'Berline dynamique, finition Luxury.',
    status: VehicleStatus.DISPONIBLE,
    purchaseType: PurchaseType.LOCATION,
    images: ['https://placehold.co/600x400?text=Serie+3'],
  },
  {
    brand: 'Volkswagen',
    model: 'Golf',
    year: 2017,
    mileage: 120000,
    price: '8900.00',
    fuelType: FuelType.ESSENCE,
    transmission: Transmission.MANUELLE,
    color: 'Gris',
    description: 'Compacte robuste, kilométrage élevé mais saine.',
    status: VehicleStatus.DISPONIBLE,
    purchaseType: PurchaseType.VENTE,
    images: ['https://placehold.co/600x400?text=Golf'],
  },
  {
    brand: 'Dacia',
    model: 'Sandero',
    year: 2023,
    mileage: 10000,
    price: '11900.00',
    fuelType: FuelType.ESSENCE,
    transmission: Transmission.MANUELLE,
    color: 'Beige',
    description: 'Quasi neuve, faible kilométrage.',
    status: VehicleStatus.DISPONIBLE,
    purchaseType: PurchaseType.VENTE,
    images: ['https://placehold.co/600x400?text=Sandero'],
  },
  // ── Véhicules NON disponibles : ne doivent pas sortir dans la liste publique ──
  {
    brand: 'Audi',
    model: 'A4',
    year: 2019,
    mileage: 95000,
    price: '21900.00',
    fuelType: FuelType.DIESEL,
    transmission: Transmission.AUTOMATIQUE,
    color: 'Noir',
    description: 'Réservée par un client.',
    status: VehicleStatus.RESERVE,
    purchaseType: PurchaseType.VENTE,
    images: ['https://placehold.co/600x400?text=A4'],
  },
  {
    brand: 'Citroën',
    model: 'C3',
    year: 2022,
    mileage: 25000,
    price: '13900.00',
    fuelType: FuelType.ESSENCE,
    transmission: Transmission.MANUELLE,
    color: 'Blanc',
    description: 'Actuellement en location.',
    status: VehicleStatus.LOUE,
    purchaseType: PurchaseType.LOCATION,
    images: ['https://placehold.co/600x400?text=C3'],
  },
  {
    brand: 'Mercedes',
    model: 'Classe A',
    year: 2020,
    mileage: 40000,
    price: '29900.00',
    fuelType: FuelType.ESSENCE,
    transmission: Transmission.AUTOMATIQUE,
    color: 'Gris',
    description: 'Déjà vendue.',
    status: VehicleStatus.VENDU,
    purchaseType: PurchaseType.VENTE,
    images: ['https://placehold.co/600x400?text=Classe+A'],
  },
];

async function main(): Promise<void> {
  await seedUsers();

  // Idempotent : on repart d'un catalogue propre à chaque exécution.
  await prisma.vehicle.deleteMany();

  const result = await prisma.vehicle.createMany({ data: vehicles });

  const disponibles = vehicles.filter((v) => v.status === VehicleStatus.DISPONIBLE).length;
  logger.info(`Seed terminé : ${result.count} véhicules créés (${disponibles} DISPONIBLE).`);
}

main()
  .catch((error) => {
    logger.error('Échec du seed', { error });
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

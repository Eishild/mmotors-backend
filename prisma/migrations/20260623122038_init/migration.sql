-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'GESTIONNAIRE', 'ADMIN');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('ESSENCE', 'DIESEL', 'HYBRIDE', 'ELECTRIQUE');

-- CreateEnum
CREATE TYPE "Transmission" AS ENUM ('MANUELLE', 'AUTOMATIQUE');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('DISPONIBLE', 'VENDU', 'LOUE', 'RESERVE');

-- CreateEnum
CREATE TYPE "PurchaseType" AS ENUM ('VENTE', 'LOCATION');

-- CreateEnum
CREATE TYPE "DossierType" AS ENUM ('ACHAT', 'LOCATION');

-- CreateEnum
CREATE TYPE "DossierStatus" AS ENUM ('EN_ATTENTE_DOCUMENTS', 'EN_COURS', 'COMPLEMENT_DEMANDE', 'VALIDE', 'REFUSE');

-- CreateEnum
CREATE TYPE "OptionType" AS ENUM ('ASSURANCE_TOUS_RISQUES', 'ASSISTANCE_DEPANNAGE', 'ENTRETIEN_SAV', 'CONTROLE_TECHNIQUE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CLIENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "mileage" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "fuelType" "FuelType" NOT NULL,
    "transmission" "Transmission",
    "color" TEXT,
    "description" TEXT,
    "status" "VehicleStatus" NOT NULL DEFAULT 'DISPONIBLE',
    "purchaseType" "PurchaseType" NOT NULL,
    "images" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dossier" (
    "id" TEXT NOT NULL,
    "type" "DossierType" NOT NULL,
    "status" "DossierStatus" NOT NULL DEFAULT 'EN_ATTENTE_DOCUMENTS',
    "refusalMotif" TEXT,
    "clientId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DossierOption" (
    "id" TEXT NOT NULL,
    "type" "OptionType" NOT NULL,
    "dossierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DossierOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "dossierId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DossierOption_dossierId_type_key" ON "DossierOption"("dossierId", "type");

-- AddForeignKey
ALTER TABLE "Dossier" ADD CONSTRAINT "Dossier_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dossier" ADD CONSTRAINT "Dossier_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DossierOption" ADD CONSTRAINT "DossierOption_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

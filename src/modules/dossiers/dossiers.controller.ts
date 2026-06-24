import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../types';
import { AppError } from '../../middlewares/errorHandler';
import {
  AddDossierOptionsInput,
  CreateDossierInput,
  UpdateDossierStatusInput,
  dossierIdParamSchema,
  listDossiersQuerySchema,
} from './dossiers.schema';
import * as dossiersService from './dossiers.service';

/**
 * GET /dossiers/me — suivi par le client de ses propres dossiers (US-007).
 * clientId vient du JWT : impossible de lister les dossiers d'autrui.
 */
export async function getMyDossiers(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dossiers = await dossiersService.listMyDossiers(req.user!.id);
    res.status(200).json({ data: dossiers });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /dossiers — liste back-office des dossiers à instruire (US-010).
 * Query (status/type/pagination) parsée ici car elle nécessite coercition.
 */
export async function listDossiers(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listDossiersQuerySchema.parse(req.query);
    const result = await dossiersService.listDossiers(query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /dossiers/:id/status — valider / refuser / demander un complément (US-011).
 * Corps validé par validate(updateDossierStatusSchema) ; :id validé ici.
 */
export async function updateDossierStatus(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dossierId = dossierIdParamSchema.parse(req.params.id);
    const dossier = await dossiersService.updateDossierStatus(
      dossierId,
      req.body as UpdateDossierStatusInput,
    );
    res.status(200).json({ data: dossier });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /dossiers — dépôt d'un dossier par le client connecté (US-005 / US-006).
 *
 * req.body a été validé/typé par validate(createDossierSchema) ; clientId est
 * dérivé du JWT (req.user), jamais du corps.
 */
export async function createDossier(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dossier = await dossiersService.createDossier(
      req.user!.id,
      req.body as CreateDossierInput,
    );
    res.status(201).json({ data: dossier });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /dossiers/:id/documents — upload d'une pièce justificative (US-005).
 *
 * Le binaire est fourni en multipart sous le champ `document` et a été placé en
 * mémoire (req.file.buffer) par multer. authenticate garantit req.user.
 */
export async function uploadDossierDocument(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // :id validé manuellement (le middleware validate ne couvre que le body).
    const dossierId = dossierIdParamSchema.parse(req.params.id);

    if (!req.file) {
      throw new AppError(400, 'Aucun fichier fourni (champ "document" attendu)');
    }

    // authenticate a déjà rempli req.user ; on le borne pour TypeScript.
    const document = await dossiersService.addDocumentToDossier(dossierId, req.user!, req.file);

    res.status(201).json({ data: document });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /dossiers/:id/options — le client locataire ajoute ses options (US-006).
 * clientId vient du JWT : un client A visant le dossier de B reçoit 403 (service).
 */
export async function addDossierOptions(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dossierId = dossierIdParamSchema.parse(req.params.id);
    const dossier = await dossiersService.addOptionsToDossier(
      dossierId,
      req.user!.id,
      req.body as AddDossierOptionsInput,
    );
    res.status(201).json({ data: dossier });
  } catch (error) {
    next(error);
  }
}

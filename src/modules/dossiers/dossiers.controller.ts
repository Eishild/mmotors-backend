import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../types';
import { AppError } from '../../middlewares/errorHandler';
import { CreateDossierInput, dossierIdParamSchema } from './dossiers.schema';
import * as dossiersService from './dossiers.service';

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

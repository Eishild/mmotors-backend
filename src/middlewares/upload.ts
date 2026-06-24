import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';
import { AppError } from './errorHandler';

/** Taille maximale acceptée par fichier : 10 Mo. */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** MIME types autorisés pour les documents de dossier (pièces justificatives). */
export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/**
 * Filtre de fichiers : on rejette tout ce qui n'est pas PDF/JPEG/PNG.
 *
 * On lève une AppError 400 plutôt que de passer `false` silencieusement, afin
 * que le rejet remonte au errorHandler avec un message clair côté client.
 */
function fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
    cb(null, true);
    return;
  }
  cb(new AppError(400, `Type de fichier non autorisé : ${file.mimetype}`));
}

/**
 * Upload en mémoire (memoryStorage) : le fichier est exposé sur `file.buffer`.
 *
 * On garde le fichier en RAM (pas sur disque) parce qu'on le relaie
 * immédiatement vers Supabase Storage : inutile d'écrire un temporaire local.
 * La limite de 10 Mo protège la mémoire du process contre les gros uploads.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter,
});

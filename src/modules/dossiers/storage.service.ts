import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { supabase } from '../../config/supabase';
import { AppError } from '../../middlewares/errorHandler';

/** Bucket privé Supabase Storage dédié aux pièces justificatives des dossiers. */
const BUCKET = 'dossier-documents';

/** Durée de validité d'une URL signée : 60 secondes. */
const SIGNED_URL_TTL_SECONDS = 60;

export interface UploadedDocument {
  /** Chemin de l'objet dans le bucket (à persister en base). */
  filePath: string;
}

/**
 * Upload un document vers le bucket privé `dossier-documents`.
 *
 * Le chemin est `<dossierId>/<uuid><ext>` :
 *  - le préfixe par dossier range les fichiers et facilite des RLS policies
 *    futures basées sur le dossier ;
 *  - le nom de fichier est un UUID (et non le nom d'origine) pour éviter les
 *    collisions et ne pas fuiter d'information via le nom fourni par le client.
 *
 * On utilise `crypto.randomUUID` (natif Node ≥ 20) plutôt qu'une dépendance
 * `uuid` externe : zéro dépendance supplémentaire pour le même résultat.
 */
export async function uploadDocument(
  dossierId: string,
  file: Express.Multer.File,
): Promise<UploadedDocument> {
  // On dérive l'extension du nom d'origine, mais le contentType fait foi côté
  // stockage (déjà validé par le fileFilter multer).
  const ext = path.extname(file.originalname).toLowerCase();
  const filePath = `${dossierId}/${randomUUID()}${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(filePath, file.buffer, {
    contentType: file.mimetype,
    // Pas d'upsert : un UUID frais ne doit jamais écraser un objet existant.
    upsert: false,
  });

  if (error) {
    throw new AppError(502, `Échec de l'upload du document : ${error.message}`);
  }

  return { filePath };
}

/**
 * Génère une URL signée valable 60 s pour accéder à un document du bucket privé.
 *
 * Le bucket étant privé, c'est le seul moyen de servir le fichier à un client
 * autorisé sans exposer la clé service_role. La courte durée de vie limite la
 * fenêtre pendant laquelle un lien partagé reste exploitable.
 */
export async function getSignedUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    throw new AppError(502, `Impossible de générer l'URL signée : ${error?.message ?? 'inconnue'}`);
  }

  return data.signedUrl;
}

/**
 * Gestion du streaming des événements ChatKit
 *
 * Ce fichier réexporte tous les modules de streaming pour maintenir
 * la rétrocompatibilité avec les imports existants.
 *
 * Structure des modules:
 * - streaming/sse.ts - Parsing des événements SSE
 * - streaming/deltas.ts - Application des événements delta au thread
 * - streaming/normalizers.ts - Normalisation des données
 * - streaming/api.ts - Fonctions d'API REST
 * - streaming/index.ts - Point d'entrée et fonction principale
 */
export * from './streaming';

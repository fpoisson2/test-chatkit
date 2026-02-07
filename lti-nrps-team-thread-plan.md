# Plan complet - Partage de thread d’equipe LTI avec roster NRPS

Date: 2026-01-30

## Objectif
Permettre a un etudiant LTI d’ajouter un ou plusieurs coequipiers a son thread. Le thread devient le thread d’equipe. Quand un invite revient, il doit retourner automatiquement au thread d’equipe, sauf s’il l’a quitte ou a ete expulse.

## Etat actuel (rappels rapides)
- LTI launch -> backend/app/lti/service.py crée/reutilise un thread par (user, resource_link, workflow) via LTIWorkflowThread et passe thread_id dans l’URL de launch.
- Frontend -> frontend/src/pages/LTILaunchPage.tsx utilise thread_id pour rediriger vers /c/{thread_id}.
- ChatKit Store -> backend/app/chatkit_store.py limite l’acces par owner_id (current_user.id).
- Contexte LTI -> backend/app/request_context.py resolve LTIUserSession le plus recent pour injecter lti_resource_link_id, etc.

## Grande idee
Ajouter un mecanisme de “thread d’equipe LTI” (share actif) + delegation d’owner dans le contexte ChatKit. Un roster LTI sera obtenu via NRPS pour proposer les utilisateurs (meme ceux qui ne se sont jamais connectes).

## Scope v1
- Support NRPS (Names & Roles) pour lister le roster d’un cours.
- Mapping de partage LTI: associer des membres a un thread d’equipe.
- Choix du thread a l’instant du launch LTI: si share actif, l’utilisateur est redirige vers le thread d’equipe.
- Delegation d’owner dans ChatKit Store pour que les invites puissent lire/ecrire dans le thread d’equipe.
- Revenir automatiquement au thread d’equipe a chaque launch tant que le share est actif.

## Donnees / Schema
1) Nouvelle table: lti_context_members
- id
- registration_id, deployment_id
- platform_context_id (cours)
- platform_user_id (sub)
- name, email (si dispo), roles (jsonb)
- last_seen_at (timestamp)
- source = "nrps" | "launch"
- unique(platform_context_id, platform_user_id)

2) Nouvelle table: lti_thread_shares
- id
- owner_user_id
- member_user_id
- resource_link_id
- workflow_id
- thread_id
- status = "active" | "removed" | "left"
- created_at, updated_at, removed_at
- unique(owner_user_id, member_user_id, resource_link_id, workflow_id)

3) Optionnel: lti_team_threads (si on veut un thread d’equipe par resource_link)
- id
- resource_link_id
- workflow_id
- thread_id
- owner_user_id
- created_at

## Flux utilisateur
A) Creation d’equipe
1. Etudiant A (owner) ouvre un workflow LTI.
2. A clique “Ajouter un coequipier”.
3. UI charge le roster NRPS pour le cours (platform_context_id).
4. A choisit B -> API cree/active un share pour (A,B,resource_link,workflow,thread_id de A).

B) Join automatique
1. B lance le meme LTI resource link.
2. Backend detecte share actif -> thread_id renvoye = thread d’equipe.
3. Frontend redirect /c/{thread_id}.
4. ChatKit Store accepte via delegation (effective_owner_id = A) et B ecrit dans le thread d’equipe.

C) Revenir si invite revient
- A chaque launch LTI, le backend re-evalue les shares actifs.
- Si share actif, renvoyer thread d’equipe; sinon thread personnel LTI.

D) Sortie / expulsion
- B “Quitte l’equipe” -> share passe a status="left".
- A “Retire un membre” -> share passe a status="removed".
- Prochain launch de B: revoit thread personnel LTI.

## Backend - NRPS
1) Lire claim NRPS depuis id_token (LTI launch)
- Claim: https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice
- Contient: context_memberships_url, service_versions

2) Stocker dans LTIUserSession (optionnel) ou dans un cache table
- Ajouter champs: nrps_memberships_url, nrps_versions

3) Service NRPS
- LTIService ou un nouveau service (backend/app/lti/nrps_service.py)
- Utiliser OAuth client credentials via LTIRegistration pour obtenir un access token
- GET memberships URL, paginer (Link header)
- Normaliser et stocker dans lti_context_members
- Mettre a jour last_seen_at

4) Routes API
- GET /api/lti/roster
  - Auth required, LTI user only
  - Recupere platform_context_id depuis LTIUserSession le plus recent
  - Si cache stale (>X minutes), rafraichir via NRPS
  - Retourne membres {platform_user_id, name, email, roles}

## Backend - Shares
1) Creer/retirer share
- POST /api/lti/thread-shares
  - body: member_platform_user_id OR member_user_id
  - verifie owner = current_user.id
  - resolve member_user_id: si connu -> users.id, sinon creer un “shadow user” LTI si besoin
  - cree/active share

- DELETE /api/lti/thread-shares/{member_user_id}
  - owner only
  - status=removed

- POST /api/lti/thread-shares/leave
  - member only
  - status=left

2) Resolution du thread au launch (LTIService.complete_launch)
- Apres _ensure_lti_thread(...) pour le user
- Chercher share actif pour (member_user_id=current_user.id, resource_link_id, workflow_id)
- Si actif -> utiliser share.thread_id
- Sinon -> thread personnel

3) Delegation d’owner dans ChatKit
- Ajouter effective_owner_id a ChatKitRequestContext
- build_chatkit_request_context:
  - determiner le thread actif pour l’utilisateur (depuis launch param/LS ou latest LTI share actif)
  - si thread partagé: effective_owner_id = owner_user_id
- chatkit_store.py
  - _resolve_owner_id_for_thread: utiliser effective_owner_id si present
  - add_thread_item/load_thread/load_items: consistent owner_id

## Frontend
1) UI
- Bouton “Ajouter un coequipier” visible pour LTI user
- Modal liste (roster NRPS)
- Etat (membre deja dans equipe, etc.)

2) Calls
- GET /api/lti/roster
- POST /api/lti/thread-shares
- POST /api/lti/thread-shares/leave

3) Etat local
- Afficher “Vous etes dans le thread d’equipe de <owner>”
- Bouton “Quitter l’equipe” pour invites

## Regles d’acces
- Un share est valide uniquement si:
  - meme resource_link_id
  - meme workflow_id
  - member_user_id != owner_user_id
- Un membre ne voit que le thread d’equipe si share actif.
- Un owner peut retirer un membre de son equipe uniquement pour ses propres threads.

## Tests
Backend:
- test_lti_nrps_roster_fetch
- test_lti_thread_share_create_remove
- test_lti_launch_uses_shared_thread
- test_chatkit_store_owner_delegation

Frontend:
- tests d’integration pour UI modal roster
- test de redirection quand share actif

## Migration et compat
- Migration SQL pour tables lti_context_members + lti_thread_shares
- No breaking change pour non-LTI

## Risques / Points d’attention
- NRPS peut etre absent selon la plateforme -> fallback sur “roster par launches”.
- Gestion des “shadow users” si membre jamais connecte (create user record LTI minimal).
- Garantir que l’owner effectif est toujours un user valide.
- Eviter escalade: un membre ne doit pas acceder a un thread hors resource_link/workflow.

## Phasage
Phase 1 (MVP)
- Table lti_thread_shares
- Delegation owner + launch selection
- UI minimale + add/leave

Phase 2
- NRPS complet + cache
- roster complet + shadow users

Phase 3
- Multi-owner ou equipe partagee multi-threads (si besoin)

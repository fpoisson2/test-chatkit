# Téléphonie multi-serveurs

Ce document décrit la configuration d'un environnement ChatKit utilisant plusieurs trunks SIP.

## Vue d'ensemble

Depuis la version actuelle, chaque workflow peut choisir son serveur SIP directement dans le bloc **Début**. Les routes téléphonie peuvent pointer vers différents trunks sans modifier la configuration globale. Un workflow qui ne renseigne pas de serveur continue d'utiliser le fallback défini dans l'administration (section *Fallback téléphonie*).

## Gestion des serveurs SIP côté backend

Les serveurs SIP sont persistés dans la table `sip_servers`. L'API d'administration expose les endpoints suivants (tous protégés par un compte administrateur) :

- `GET /api/admin/telephony/sip-servers` — liste des serveurs disponibles ;
- `POST /api/admin/telephony/sip-servers` — création d'un serveur (`id`, `label`, `trunk_uri`, champs optionnels `username`, `password`, `contact_host`, `contact_port`, `contact_transport`) ;
- `PATCH /api/admin/telephony/sip-servers/{id}` — mise à jour partielle d'un serveur ;
- `DELETE /api/admin/telephony/sip-servers/{id}` — suppression d'un serveur.

Les champs de contact permettent d'ajuster l'URI annoncé dans les REGISTER sortants (hôte, port, transport). Le mot de passe n'est jamais renvoyé par l'API ; le booléen `has_password` indique seulement si une valeur est stockée.

## Sélection du trunk à l'exécution

Lorsqu'un appel entrant démarre un workflow, ChatKit applique la règle suivante :

1. si la route téléphonie du bloc Début référence `sip_server_id`, l'enregistrement correspondant est chargé ;
2. sinon, l'application retombe sur le fallback global configuré dans l'administration ;
3. en l'absence de fallback, les variables d'environnement `SIP_*` restent valides et sont utilisées.

Les paramètres voix (`model`, `voice`, `instructions`, etc.) sont désormais principalement gérés dans le bloc **Agent vocal**. Le bloc Début ne sert plus qu'à définir les numéros entrants, le serveur SIP associé et, si besoin, un routage vers un autre workflow.

## Mise à jour de l'interface d'administration

La page *Paramètres de l'application* affiche désormais un encart "Fallback téléphonie". Les options héritées sont masquées par défaut ; elles ne doivent être utilisées que pour les workflows qui n'ont pas encore migré vers les serveurs SIP par workflow. Une fois la migration terminée, videz ces champs pour supprimer le fallback.

## Bonnes pratiques de migration

1. Créez les serveurs SIP nécessaires via l'API ou en base.
2. Mettez à jour vos workflows pour sélectionner le serveur adéquat dans le bloc Début.
3. Vérifiez le comportement via `resolve_start_telephony_config` et les tests d'intégration.
4. Lorsque tous les workflows sont migrés, supprimez (ou laissez vide) le fallback global afin d'éviter les configurations implicites.


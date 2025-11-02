# Tests manuels – Workflow Builder

## Synchronisation automatique des versions

1. Ouvrir deux navigateurs ou fenêtres distinctes sur la page du Workflow Builder en étant connecté avec le même compte.
2. Dans la première fenêtre, sélectionner un workflow existant sans laisser de modifications en attente.
3. Dans la deuxième fenêtre, ouvrir le même workflow, publier une nouvelle version ou modifier la version active puis sauvegarder.
4. Revenir sur la première fenêtre et observer que la liste des versions et le graphe se mettent à jour automatiquement sans rechargement manuel.

**Résultat attendu :** la première fenêtre récupère la version publiée par la seconde en quelques secondes, tant qu'aucune modification locale n'est en cours.

## Sélection du fournisseur de modèle par agent

1. Depuis le Workflow Builder, ajouter un nœud « Agent » ou sélectionner un agent existant.
2. Dans le panneau de configuration de l'agent, choisir un fournisseur dans la nouvelle liste déroulante « Fournisseur ».
3. Vérifier que la liste des modèles se met à jour pour n'afficher que les modèles exposés par ce fournisseur.
4. Sauvegarder le workflow puis ré-ouvrir l'agent pour confirmer que le couple fournisseur/modèle est correctement restauré.
5. (Optionnel) Exécuter le workflow afin de s'assurer que la requête utilise bien les identifiants du fournisseur sélectionné.

**Résultat attendu :** chaque agent mémorise le fournisseur et le modèle choisis, et l'exécution du workflow s'appuie sur les informations d'authentification correspondantes.

## Boucles dans les workflows

Les cycles explicites sont désormais autorisés dans les graphes de workflow. Lors des tests manuels, vérifiez qu'un chemin de sortie (nœud **End**) reste accessible et qu'une condition de sortie réaliste met fin à l'exécution. Le moteur d'exécution applique une limite de 1000 itérations consécutives lors du parcours d'un workflow, ce qui garantit qu'une boucle sans issue n'entraîne pas de blocage infini.

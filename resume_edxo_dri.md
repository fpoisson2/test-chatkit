# EDxo — Plateforme d'assistance pédagogique par IA

**Responsable** : Francis Poisson

**Référence** : Demande existante LIM#183502

---

## Contexte et origine du projet

EDxo est né d'un constat terrain : en tant qu'enseignant en génie électrique, l'utilisation de l'IA par les étudiants est une réalité croissante. Dès qu'ils rencontrent un bogue ou une difficulté, ils se tournent vers des outils comme ChatGPT — sans que l'enseignant ait de visibilité sur les échanges, les réponses obtenues ou la démarche suivie. Plutôt que d'interdire cette pratique, EDxo propose de l'encadrer en offrant aux enseignants les outils pour créer des assistants IA adaptés à leurs cours, avec des consignes pédagogiques précises, un contrôle sur les réponses fournies et une traçabilité complète des interactions. En parallèle, la plateforme automatise la rédaction des documents de programme (plans-cadres, plans de cours, grilles d'évaluation), libérant du temps pour l'accompagnement des étudiants.

Pour répondre à ces irritants, deux applications complémentaires ont été développées de façon indépendante sous le nom EDxo, avec l'objectif de les fusionner en une plateforme unifiée :

- **EDxo — Génération de documents pédagogiques** : automatise la création et l'amélioration des plans-cadres, des plans de cours et des grilles d'évaluation à l'aide de l'IA.
- **EDxo — Assistants conversationnels pour les séances** : permet de créer et déployer des assistants IA pour accompagner les étudiants en laboratoire, avec suivi en temps réel et rétroaction immédiate.

Ces deux volets répondent au même objectif : réduire la charge administrative et répétitive des enseignants pour leur permettre de se concentrer sur ce qui compte — l'accompagnement pédagogique des étudiants. Ce sont des outils que j'utilise au quotidien dans mon travail.

---

## Volet 1 — Génération de documents pédagogiques

### Le problème

La rédaction et la mise à jour des plans-cadres, des plans de cours et des grilles d'évaluation sont des tâches longues, répétitives et souvent effectuées dans l'urgence. Chaque session, chaque enseignant y consacre de nombreuses heures pour des documents qui partagent pourtant une structure commune.

### La solution

EDxo automatise la génération et l'amélioration de ces documents grâce à l'IA :

- **Plans-cadres** : génération complète ou amélioration section par section, importation de documents existants (DOCX), exportation formatée, page de comparaison et validation avant publication
- **Plans de cours** : génération globale incluant le calendrier et les évaluations, amélioration champ par champ, révision avant/après avec possibilité de confirmer ou annuler chaque modification, exportation DOCX
- **Grilles d'évaluation et logigrammes** : génération dédiée avec paramètres IA adaptés au domaine d'enseignement
- **Importation de documents existants** : devis ministériels PDF, grilles PDF, avec suivi de l'importation et validation finale
- **Clavardage intégré** : un assistant conversationnel permet de poser des questions sur ses documents, avec niveau de raisonnement et verbosité ajustables

L'enseignant conserve le contrôle à chaque étape : il révise, compare, confirme ou annule toute modification proposée par l'IA.

---

## Volet 2 — Assistants conversationnels pour les séances

### Le problème

Que ce soit en laboratoire, lors d'exercices ou dans d'autres activités pédagogiques, il est difficile d'offrir une rétroaction individualisée et immédiate à chaque étudiant. Les étudiants attendent, perdent du temps, ou avancent avec des erreurs non corrigées. La rétroaction arrive souvent plusieurs jours après la séance, quand le contexte d'apprentissage est perdu.

### La solution

L'enseignant crée des assistants conversationnels adaptés à ses cours, sans programmation, à l'aide d'un éditeur visuel par blocs glisser-déposer :

**1. Création de parcours conversationnels adaptés au cours**

- Le ton et les consignes pédagogiques (ex. : guider sans donner la réponse)
- Les étapes du parcours de l'étudiant et les branchements selon ses réponses
- Les documents de référence du cours que l'assistant peut consulter
- Les critères d'évaluation et les grilles de correction

Aucune programmation n'est requise. L'enseignant travaille avec des blocs visuels qu'il connecte entre eux.

**2. Pilotage vocal pendant la séance**

Pendant un laboratoire, l'enseignant peut piloter son assistant par la voix, directement depuis l'interface de conception. Il peut demander vocalement de :

- Voir où en sont ses étudiants dans le parcours
- Modifier le contenu d'un message ou d'une consigne, avec application immédiate
- Améliorer une rétroaction à l'aide de l'IA selon ses directives
- Débloquer un étudiant coincé à une étape
- Publier un changement en direct vers toutes les conversations en cours

L'enseignant supervise et ajuste son parcours sans quitter le regard de ses étudiants, simplement en parlant. Le pilotage vocal peut également se faire depuis un téléphone Android ou une montre connectée Android (Wear OS).

**3. Suivi en temps réel de la progression des étudiants**

L'enseignant voit directement sur son écran, superposé à son parcours visuel, quels étudiants sont rendus à quelle étape. Il repère instantanément ceux qui sont bloqués, en difficulté ou inactifs, sans avoir à circuler dans la salle ou à consulter un tableau de bord séparé.

**4. Mise à jour en direct des messages du parcours**

Pendant une séance, l'enseignant peut constater qu'un message de son parcours manque de clarté, contient une erreur ou nécessite des précisions supplémentaires. Il peut alors modifier le contenu du message directement dans le constructeur et publier la correction en un clic. La mise à jour est poussée instantanément :

- Aux étudiants qui sont déjà rendus à cette étape — le message se met à jour sous leurs yeux
- Aux étudiants qui atteindront cette étape par la suite — ils verront la version corrigée

Cela permet à l'enseignant d'ajuster son parcours en temps réel selon ce qu'il observe en classe : si plusieurs étudiants posent la même question, il ajoute une précision au message concerné plutôt que de répéter l'explication individuellement. Le parcours s'améliore au fil de la séance.

**5. Envoi automatique des notes vers Moodle**

L'application s'intègre avec Moodle via le standard LTI 1.3 :

- L'assistant est accessible directement depuis un cours Moodle
- Les étudiants sont authentifiés automatiquement par Moodle
- Les notes et résultats d'évaluation sont renvoyés automatiquement au carnet de notes, éliminant la double saisie

---

## Gains de productivité globaux

- **Réduction de la charge administrative** : automatisation de la rédaction des plans-cadres, plans de cours et grilles d'évaluation
- **Rétroaction immédiate** : l'étudiant reçoit un accompagnement personnalisé en temps réel pendant les laboratoires, plutôt qu'après plusieurs jours
- **Accompagnement individualisé à grande échelle** : chaque étudiant bénéficie d'un tuteur disponible en continu, sans surcharge pour l'enseignant
- **Supervision simplifiée** : l'enseignant voit d'un coup d'œil la progression de toute sa classe et intervient au besoin, vocalement ou manuellement
- **Élimination de la double saisie** : les notes sont transmises directement à Moodle
- **Réutilisabilité** : les parcours et les documents créés peuvent être réutilisés, partagés ou adaptés pour d'autres sessions ou d'autres enseignants

---

## Sécurité et intégration institutionnelle

- **Authentification** : une intégration avec Microsoft Entra serait bénéfique pour assurer une gestion sécurisée des accès via l'infrastructure existante du collège. Un accompagnement de la DRI serait souhaité pour réaliser cette intégration
- **Solution libre** : le code est ouvert et transparent, permettant la traçabilité des améliorations sans dépendance contractuelle envers un fournisseur
- **Évolution continue** : en collaboration avec la DRI, les fonctionnalités de sécurité peuvent être testées et améliorées de façon continue pour respecter les standards institutionnels

---

## Contrôle des données et évolution à long terme

Un hébergement sur l'infrastructure du collège permettrait :

- **Protection des données étudiantes** : toutes les conversations et traces d'apprentissage restent à l'interne, sans transit vers des serveurs externes non contrôlés
- **Constitution d'un corpus pédagogique** : les données collectées (questions fréquentes, erreurs typiques, rétroactions validées, documents améliorés) constituent une base de connaissances institutionnelle qui pourrait servir à améliorer les pratiques d'enseignement
- **Adaptation des modèles IA** : à terme, ces données pourraient servir au réentraînement de modèles adaptés aux réalités spécifiques du collège et de ses programmes, réduisant la dépendance aux fournisseurs externes
- **Conformité ministérielle** : documentation complète de l'utilisation de l'IA, avec traçabilité des échanges, tel qu'exigé par le Ministère

---

## Un mode de développement en pleine croissance

EDxo a été développé en grande partie à l'aide de l'IA — une approche de plus en plus répandue dans l'industrie. Les outils de programmation assistée par IA (Claude Code, GitHub Copilot, Cursor, etc.) permettent aujourd'hui à des professionnels non-programmeurs de créer des applications fonctionnelles pour répondre à des besoins concrets de leur milieu.

Ce phénomène est en forte croissance et ne se limitera pas aux développeurs professionnels. Dans les prochaines années, de plus en plus d'enseignants, de conseillers pédagogiques et de professionnels du collège seront en mesure de créer des outils adaptés à leurs besoins grâce à l'IA. Le collège a tout intérêt à se préparer à cette réalité en développant la capacité d'accompagner ces initiatives : validation de la sécurité, hébergement interne, intégration à l'infrastructure existante.

D'ailleurs, dans le cadre de mes cours en génie électrique, j'enseigne déjà les outils d'IA agentique pour la programmation — c'est une compétence que les étudiants devront maîtriser sur le marché du travail. EDxo s'inscrit dans cette même tendance. Collaborer avec la DRI pour accompagner ce type d'initiative permettrait d'établir un cadre et des bonnes pratiques pour le faire de façon sécuritaire.

---

## Alignement avec le plan stratégique

- **Accomplissement personnel et professionnel** : ce projet est né d'une initiative personnelle pour résoudre des irritants concrets du travail enseignant. Un soutien de la DRI valoriserait cette démarche d'intrapreneuriat et créerait un environnement favorable à l'expérimentation pédagogique.
- **Trajectoires de réussite et amélioration continue** : EDxo libère du temps pour que les enseignants puissent se concentrer sur l'accompagnement des étudiants. L'approche agile, basée sur des retours réguliers d'expérience, favorise l'amélioration continue des pratiques de gestion de programme.

---

## Déploiement

Les deux applications sont entièrement conteneurisées et prêtes à être déployées sur une infrastructure interne. Elles s'intègrent à l'écosystème Moodle existant du collège. L'enseignant n'a besoin que d'un navigateur web. L'objectif à terme est de fusionner les deux volets en une plateforme unifiée.

---

*Générée à l'aide de l'IA*

import {
  isPlainRecord,
  type AgentParameters,
  type StateAssignment,
  type StateAssignmentScope,
} from "./workflows";

/**
 * Préconfigurations héritées des agents spécifiques afin de pré-remplir les blocs
 * génériques lors de l'import d'un workflow existant.
 */
const TRIAGE_DEFAULT_INSTRUCTIONS = `Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.
Si oui → has_all_details: true
Sinon → has_all_details: false + lister uniquement les éléments manquants

Ne génère pas encore le plan-cadre.

Informations attendues
Le plan-cadre pourra être généré seulement si les champs suivants sont fournis :
code_cours:
nom_cours:
programme:
fil_conducteur:
session:
cours_prealables: []       # Codes + titres
cours_requis: []           # (optionnel)
cours_reliés: []           # (optionnel)
heures_theorie:
heures_lab:
heures_maison:
competences_developpees: []   # Codes + titres
competences_atteintes: []     # Codes + titres
competence_nom:               # Pour la section Description des compétences développées
cours_developpant_une_meme_competence: [] # Pour les activités pratiques
Une idée générale de ce qui devrait se retrouver dans le cours.`;

const R_DACTEUR_DEFAULT_INSTRUCTIONS = `Tu es un assistant pédagogique qui génère, en français, des contenus de plan-cadre selon le ton institutionnel : clairs, concis, rigoureux, rédigés au vouvoiement. Tu ne t’appuies que sur les informations fournies dans le prompt utilisateur, sans inventer de contenu. Si une information manque et qu’aucune directive de repli n’est donnée, omets l’élément manquant.

**CONTRAINTE SPÉCIALE – SAVOIR ET SAVOIR-FAIRE PAR CAPACITÉ**
Pour chaque capacité identifiée dans le cours, tu dois générer explicitement :
- La liste des savoirs nécessaires à la maîtrise de cette capacité (minimum 10 par capacité)
- La liste des savoir-faire associés à cette même capacité (minimum 10 par capacité, chacun avec niveau cible et seuil)

Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre.
Demande à l'utilisateur les informations manquantes.

SECTIONS ET RÈGLES DE GÉNÉRATION

## Intro et place du cours
Génère une description détaillée pour le cours «{{code_cours}} – {{nom_cours}}» qui s’inscrit dans le fil conducteur «{{fil_conducteur}}» du programme de {{programme}} et se donne en session {{session}} de la grille de cours.

La description devra comporter :

Une introduction qui situe le cours dans son contexte (code, nom, fil conducteur, programme et session).

Une explication sur l’importance des connaissances préalables pour réussir ce cours.

Pour chaque cours préalable listé dans {{cours_prealables}}, détaillez les connaissances et compétences essentielles acquises et expliquez en quoi ces acquis sont indispensables pour aborder les notions spécifiques du cours actuel.

Le texte final devra adopter un style clair et pédagogique, similaire à l’exemple suivant, mais adapté au contenu du présent cours :

"Le cours «243-4Q4 – Communication radio» s’inscrit dans le fil conducteur «Sans-fil et fibre optique» du programme de Technologie du génie électrique : Réseaux et télécommunications et se donne en session 4. Afin de bien réussir ce cours, il est essentiel de maîtriser les connaissances préalables acquises dans «nom du cours», particulièrement [connaissances et compétences]. Ces acquis permettront aux personnes étudiantes de saisir plus aisément les notions [ de ... ]abordées dans le présent cours."

---

## Objectif terminal
Écrire un objectif terminal pour le cours {{nom_cours}} qui devrait commencer par: "Au terme de ce cours, les personnes étudiantes seront capables de" et qui termine par un objectif terminal qui correspond aux compétences à développer ou atteinte({{competences_developpees}}{{competences_atteintes}}). Celui-ci devrait clair, mais ne comprendre que 2 ou 3 actes. Le e nom du cours donne de bonnes explications sur les technologies utilisés dans le cours, à intégrer dans l'objectif terminal.

---

## Introduction Structure du Cours
Le cours «{{nom_cours}}» prévoit {{heures_theorie}} heures de théorie, {{heures_lab}} heures d’application en travaux pratiques ou en laboratoire et {{heures_maison}} heures de travail personnel sur une base hebdomadaire.

---

## Activités Théoriques
Écrire un texte sous cette forme adapté à la nature du cours ({{nom_cours}}), celui-ci devrait être similaire en longueur et en style:

"Les séances théoriques du cours visent à préparer les personnes étudiantes en vue de la mise en pratique de leurs connaissances au laboratoire. Ces séances seront axées sur plusieurs aspects, notamment les éléments constitutifs des systèmes électroniques analogiques utilisés en télécommunications. Les personnes étudiantes auront l'opportunité d'approfondir leur compréhension par le biais de discussions interactives, des exercices et des analyses de cas liés à l’installation et au fonctionnement des systèmes électroniques analogiques. "

---

## Activités Pratiques
Écrire un texte sous cette forme adapté à la nature du cours {{nom_cours}}, celui-ci devrait être similaire en longueur et en style.  Le premier chiffre après 243 indique la session sur 6 et le nom du cours donne de bonnes explications sur le matériel ou la technologie utilisé dans le cours

Voici les cours reliés:
{{cours_developpant_une_meme_competence}}

Voici un exemple provenant d'un autre cours de mes attentes:
"La structure des activités pratiques sur les 15 semaines du cours se déroulera de manière progressive et devrait se dérouler en 4 phases. La première phrase devrait s’inspirer du quotidien des personnes étudiantes qui, généralement, ont simplement utilisé des systèmes électroniques. Son objectif serait donc de favoriser la compréhension des composants essentiels des systèmes électroniques analogiques. Cela devrait conduire à une compréhension d’un système d’alimentation basé sur des panneaux solaires photovoltaïques, offrant ainsi une introduction pertinente aux systèmes d’alimentation en courant continu, utilisés dans les télécommunications. La seconde phase devrait mener l’a personne à comprendre la nature des signaux alternatifs dans le cadre de systèmes d’alimentation en courant alternatif et sur des signaux audios. La troisième phase viserait une exploration des systèmes de communication radio. Finalement, la dernière phase viserait à réaliser un projet final combinant les apprentissages réalisés, en partenariat avec les cours 243-1N5-LI - Systèmes numériques et 243-1P4-LI – Travaux d’atelier."

---

## Activités Prévues
Décrire les différentes phases de manière succincte en utilisant cette forme. Ne pas oublier que la session dure 15 semaines.

**Phase X - titre de la phase (Semaines Y à 4Z)**
  - Description de la phase

---

## Évaluation Sommative des Apprentissages
Pour la réussite du cours, la personne étudiante doit obtenir la note de 60% lorsque l'on fait la somme pondérée des capacités.

La note attribuée à une capacité ne sera pas nécessairement la moyenne cumulative des résultats des évaluations pour cette capacité, mais bien le reflet des observations constatées en cours de session, par la personne enseignante et le jugement global de cette dernière.

---

## Nature des Évaluations Sommatives
Inclure un texte similaire à celui-ci:

L’évaluation sommative devrait surtout être réalisée à partir de travaux pratiques effectués en laboratoire, alignés avec le savoir-faire évalué. Les travaux pratiques pourraient prendre la forme de...

Pour certains savoirs, il est possible que de courts examens théoriques soient le moyen à privilégier, par exemple pour les savoirs suivants:
...

---

## Évaluation de la Langue
Utiliser ce modèle:

Dans un souci de valorisation de la langue, l’évaluation de l’expression et de la communication en français se fera de façon constante par l’enseignant(e) sur une base formative, à l’oral ou à l’écrit. Son évaluation se fera sur une base sommative pour les savoir-faire reliés à la documentation. Les critères d’évaluation se trouvent au plan général d’évaluation sommative présenté à la page suivante. Les dispositions pour la valorisation de l’expression et de la communication en français sont encadrées par les modalités particulières d’application de l’article 6.6 de la PIEA (Politique institutionnelle dévaluation des apprentissages) et sont précisées dans le plan de cours.

---

## Évaluation formative des apprentissages
Sur une base régulière, la personne enseignante proposera des évaluations formatives à réaliser en classe, en équipe ou individuellement. Elle pourrait offrir des mises en situation authentiques de même que des travaux pratiques et des simulations. Des lectures dirigées pourraient également être proposées. L’évaluation formative est continue et intégrée aux activités d’apprentissage et d’enseignement et poursuit les fins suivantes :

...
Définir le concept de superposition d’ondes.
Expliquer la différence entre interférence constructive et destructive.
Décrire les causes possibles de réflexion dans un système de transmission.
Comprendre l’effet de la longueur électrique sur les ondes stationnaires.
… (jusqu’à au moins 10)
Comment adapter à ce cours
Identifier les notions clés propres au présent cours (ex. décrire les types de risques financiers, expliquer les mécanismes d’authentification en sécurité informatique, etc.).
Veiller à ce que la liste couvre l’essentiel de la base théorique nécessaire pour développer les savoir-faire ultérieurement.
Rester cohérent avec la complexité de la capacité. Pas de verbes trop avancés si on vise la simple compréhension.

---

## Savoirs faire d'une capacité
Objectif général
Définir ce que les apprenants doivent être capables de faire (actions concrètes) pour démontrer qu’ils atteignent la capacité. Chaque savoir-faire est accompagné de deux niveaux de performance : cible (100 %) et seuil de réussite (60 %).

Instructions détaillées
Lister au moins 10 savoir-faire.
Chaque savoir-faire doit commencer par un verbe à l’infinitif (ex. Mesurer, Calculer, Configurer, Vérifier, etc.).
Il doit représenter une action observable et évaluable.
Pour chaque savoir-faire, préciser :
Cible (niveau optimal, 100 %) : Formulée à l’infinitif, décrivant la maîtrise complète ou la performance idéale.
Seuil de réussite (niveau minimal, 60 %) : Aussi formulée à l’infinitif, décrivant la version minimale acceptable du même savoir-faire.
Éviter :
Les notions de quantité ou répétition (ex. « faire X fois »).
Les noms d’outils ou de technologies précises.
Exemple d’attendu
Savoir-faire : Analyser l’effet des réflexions sur une ligne de transmission

Cible (100 %) : Analyser avec précision les variations de signal en identifiant clairement l’origine des désadaptations.
Seuil (60 %) : Analyser les variations de manière suffisante pour repérer les principales anomalies et causes de désadaptation.
Savoir-faire : Mesurer l’impédance caractéristique d’un support

Cible (100 %) : Mesurer avec exactitude l’impédance en appliquant la bonne méthode et en interprétant correctement les résultats.
Seuil (60 %) : Mesurer l’impédance de base et reconnaître les écarts majeurs par rapport à la valeur attendue.
(jusqu’à avoir 10 savoir-faire minimum)

Comment adapter au présent cours
Transformer les actions en fonction du domaine (ex. Configurer un serveur Web, Concevoir une base de données, Effectuer une analyse de rentabilité, etc.).
Ajuster le langage et la précision selon le niveau visé (Bloom). Par exemple, Appliquer ou Mettre en œuvre pour un niveau intermédiaire, Concevoir ou Évaluer pour un niveau avancé.
Adapter les niveaux cible et seuil pour refléter les attendus concrets dans la pratique de votre discipline.

---

## Moyen d'évaluation d'une capacité
Trouve 3 ou 4 moyens d'évaluations adaptés pour cette capacité.

# Remarques

- Respecter la logique explicite : lier savoirs, savoir-faire et évaluation à chaque capacité (ne pas globaliser).
- S’assurer que chaque tableau “capacités” contient systématiquement la triple structure : savoirs, savoir-faire, moyens d’évaluation.
- Reproduire fidèlement la langue et le degré de précision montré dans les exemples.
- Pour toutes les listes longues (ex : savoirs, savoir-faire), fournir la longueur requise (même si exemples ci-dessous sont abrégés).
- Pour les exemples, utiliser des placeholders réalistes : (ex : “Décrire les principes de base du [concept central du cours]”).

---

**Résumé importante** :
Pour chaque capacité, générez immédiatement après son texte et sa pondération :
- La liste complète de ses savoirs nécessaires ;
- La liste complète de ses savoir-faire associés (avec cible et seuil) ;
- Les moyens d’évaluation pertinents pour cette capacité.

Générez les autres sections exactement comme décrit, sans ajout ni omission spontanée.`;

const GET_DATA_FROM_WEB_INSTRUCTIONS = `Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre.
Va chercher sur le web pour les informations manquantes.

Voici les informations manquantes:
 {{state_infos_manquantes}}

code_cours:
nom_cours:
programme:
fil_conducteur:
session:
cours_prealables: []       # Codes + titres
cours_requis: []           # (optionnel)
cours_reliés: []           # (optionnel)
heures_theorie:
heures_lab:
heures_maison:
competences_developpees: []   # Codes + titres
competences_atteintes: []     # Codes + titres
competence_nom:               # Pour la section Description des compétences développées
cours_developpant_une_meme_competence: [] # Pour les activités pratiques
Une idée générale de ce qui devrait se retrouver dans le cours`;

const TRIAGE_2_INSTRUCTIONS = `Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.
Si oui → has_all_details: true
Sinon → has_all_details: false + lister uniquement les éléments manquants

Ne génère pas encore le plan-cadre.

Informations attendues
Le plan-cadre pourra être généré seulement si les champs suivants sont fournis :
code_cours:
nom_cours:
programme:
fil_conducteur:
session:
cours_prealables: []       # Codes + titres cours_requis: []           # (optionnel)
cours_reliés: []           # (optionnel)
heures_theorie:
heures_lab:
heures_maison:
competences_developpees: []   # Codes + titres
competences_atteintes: []     # Codes + titres
competence_nom:               # Pour la section Description des compétences développées cours_developpant_une_meme_competence: [] # Pour les activités pratiques
Une idée générale de ce qui devrait se retrouver dans le cours.

Voici les informations connues {{input_output_text}}`;

const GET_DATA_FROM_USER_INSTRUCTIONS = `Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre.

Arrête-toi et demande à l'utilisateur les informations manquantes.
infos manquantes:
 {{state_infos_manquantes}}`;

const TRIAGE_RESPONSE_SCHEMA = {
  properties: {
    has_all_details: {
      title: "Has All Details",
      type: "boolean",
    },
    details_manquants: {
      title: "Details Manquants",
      type: "string",
    },
  },
  required: ["has_all_details", "details_manquants"],
  title: "TriageSchema",
  type: "object",
} as const;

const R_DACTEUR_RESPONSE_SCHEMA = {
  $defs: {
    RDacteurSchemaActivitesPratiques: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
      },
      required: ["texte"],
      title: "RDacteurSchemaActivitesPratiques",
      type: "object",
    },
    RDacteurSchemaActivitesPrevuesItem: {
      properties: {
        phase: {
          title: "Phase",
          type: "string",
        },
        description: {
          title: "Description",
          type: "string",
        },
      },
      required: ["phase", "description"],
      title: "RDacteurSchemaActivitesPrevuesItem",
      type: "object",
    },
    RDacteurSchemaActivitesTheoriques: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
      },
      required: ["texte"],
      title: "RDacteurSchemaActivitesTheoriques",
      type: "object",
    },
    RDacteurSchemaCapaciteItem: {
      properties: {
        capacite: {
          title: "Capacite",
          type: "string",
        },
        pond_min: {
          title: "Pond Min",
          type: "number",
        },
        pond_max: {
          title: "Pond Max",
          type: "number",
        },
        savoirs_necessaires_capacite: {
          items: {
            type: "string",
          },
          title: "Savoirs Necessaires Capacite",
          type: "array",
        },
        savoirs_faire_capacite: {
          items: {
            $ref: "#/$defs/RDacteurSchemaSavoirsFaireCapaciteItem",
          },
          title: "Savoirs Faire Capacite",
          type: "array",
        },
        moyens_evaluation_capacite: {
          items: {
            type: "string",
          },
          title: "Moyens Evaluation Capacite",
          type: "array",
        },
      },
      required: [
        "capacite",
        "pond_min",
        "pond_max",
        "savoirs_necessaires_capacite",
        "savoirs_faire_capacite",
        "moyens_evaluation_capacite",
      ],
      title: "RDacteurSchemaCapaciteItem",
      type: "object",
    },
    RDacteurSchemaCompetencesCertifieesItem: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
        description: {
          title: "Description",
          type: "string",
        },
      },
      required: ["texte", "description"],
      title: "RDacteurSchemaCompetencesCertifieesItem",
      type: "object",
    },
    RDacteurSchemaCompetencesDeveloppeesItem: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
        description: {
          title: "Description",
          type: "string",
        },
      },
      required: ["texte", "description"],
      title: "RDacteurSchemaCompetencesDeveloppeesItem",
      type: "object",
    },
    RDacteurSchemaCoursCorequisItem: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
        description: {
          title: "Description",
          type: "string",
        },
      },
      required: ["texte", "description"],
      title: "RDacteurSchemaCoursCorequisItem",
      type: "object",
    },
    RDacteurSchemaCoursPrealablesItem: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
        description: {
          title: "Description",
          type: "string",
        },
      },
      required: ["texte", "description"],
      title: "RDacteurSchemaCoursPrealablesItem",
      type: "object",
    },
    RDacteurSchemaCoursReliesItem: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
        description: {
          title: "Description",
          type: "string",
        },
      },
      required: ["texte", "description"],
      title: "RDacteurSchemaCoursReliesItem",
      type: "object",
    },
    RDacteurSchemaEvaluationFormative: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
      },
      required: ["texte"],
      title: "RDacteurSchemaEvaluationFormative",
      type: "object",
    },
    RDacteurSchemaEvaluationLangue: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
      },
      required: ["texte"],
      title: "RDacteurSchemaEvaluationLangue",
      type: "object",
    },
    RDacteurSchemaEvaluationSommative: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
      },
      required: ["texte"],
      title: "RDacteurSchemaEvaluationSommative",
      type: "object",
    },
    RDacteurSchemaIntroPlaceCours: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
      },
      required: ["texte"],
      title: "RDacteurSchemaIntroPlaceCours",
      type: "object",
    },
    RDacteurSchemaNatureEvaluationsSommatives: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
      },
      required: ["texte"],
      title: "RDacteurSchemaNatureEvaluationsSommatives",
      type: "object",
    },
    RDacteurSchemaObjectifTerminal: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
      },
      required: ["texte"],
      title: "RDacteurSchemaObjectifTerminal",
      type: "object",
    },
    RDacteurSchemaObjetsCiblesItem: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
        description: {
          title: "Description",
          type: "string",
        },
      },
      required: ["texte", "description"],
      title: "RDacteurSchemaObjetsCiblesItem",
      type: "object",
    },
    RDacteurSchemaSavoirsFaireCapaciteItem: {
      properties: {
        savoir_faire: {
          title: "Savoir Faire",
          type: "string",
        },
        cible_100: {
          title: "Cible 100",
          type: "string",
        },
        seuil_60: {
          title: "Seuil 60",
          type: "string",
        },
      },
      required: ["savoir_faire", "cible_100", "seuil_60"],
      title: "RDacteurSchemaSavoirsFaireCapaciteItem",
      type: "object",
    },
    RDacteurSchemaStructureIntro: {
      properties: {
        texte: {
          title: "Texte",
          type: "string",
        },
      },
      required: ["texte"],
      title: "RDacteurSchemaStructureIntro",
      type: "object",
    },
  },
  properties: {
    intro_place_cours: {
      $ref: "#/$defs/RDacteurSchemaIntroPlaceCours",
    },
    objectif_terminal: {
      $ref: "#/$defs/RDacteurSchemaObjectifTerminal",
    },
    structure_intro: {
      $ref: "#/$defs/RDacteurSchemaStructureIntro",
    },
    activites_theoriques: {
      $ref: "#/$defs/RDacteurSchemaActivitesTheoriques",
    },
    activites_pratiques: {
      $ref: "#/$defs/RDacteurSchemaActivitesPratiques",
    },
    activites_prevues: {
      items: {
        $ref: "#/$defs/RDacteurSchemaActivitesPrevuesItem",
      },
      title: "Activites Prevues",
      type: "array",
    },
    evaluation_sommative: {
      $ref: "#/$defs/RDacteurSchemaEvaluationSommative",
    },
    nature_evaluations_sommatives: {
      $ref: "#/$defs/RDacteurSchemaNatureEvaluationsSommatives",
    },
    evaluation_langue: {
      $ref: "#/$defs/RDacteurSchemaEvaluationLangue",
    },
    evaluation_formative: {
      $ref: "#/$defs/RDacteurSchemaEvaluationFormative",
    },
    competences_developpees: {
      items: {
        $ref: "#/$defs/RDacteurSchemaCompetencesDeveloppeesItem",
      },
      title: "Competences Developpees",
      type: "array",
    },
    competences_certifiees: {
      items: {
        $ref: "#/$defs/RDacteurSchemaCompetencesCertifieesItem",
      },
      title: "Competences Certifiees",
      type: "array",
    },
    cours_corequis: {
      items: {
        $ref: "#/$defs/RDacteurSchemaCoursCorequisItem",
      },
      title: "Cours Corequis",
      type: "array",
    },
    objets_cibles: {
      items: {
        $ref: "#/$defs/RDacteurSchemaObjetsCiblesItem",
      },
      title: "Objets Cibles",
      type: "array",
    },
    cours_relies: {
      items: {
        $ref: "#/$defs/RDacteurSchemaCoursReliesItem",
      },
      title: "Cours Relies",
      type: "array",
    },
    cours_prealables: {
      items: {
        $ref: "#/$defs/RDacteurSchemaCoursPrealablesItem",
      },
      title: "Cours Prealables",
      type: "array",
    },
    savoir_etre: {
      items: {
        type: "string",
      },
      title: "Savoir Etre",
      type: "array",
    },
    capacite: {
      items: {
        $ref: "#/$defs/RDacteurSchemaCapaciteItem",
      },
      title: "Capacite",
      type: "array",
    },
  },
  required: [
    "intro_place_cours",
    "objectif_terminal",
    "structure_intro",
    "activites_theoriques",
    "activites_pratiques",
    "activites_prevues",
    "evaluation_sommative",
    "nature_evaluations_sommatives",
    "evaluation_langue",
    "evaluation_formative",
    "competences_developpees",
    "competences_certifiees",
    "cours_corequis",
    "objets_cibles",
    "cours_relies",
    "cours_prealables",
    "savoir_etre",
    "capacite",
  ],
  title: "RDacteurSchema",
  type: "object",
} as const;

const TRIAGE_2_RESPONSE_SCHEMA = {
  properties: {
    has_all_details: {
      title: "Has All Details",
      type: "boolean",
    },
    details_manquants: {
      title: "Details Manquants",
      type: "string",
    },
  },
  required: ["has_all_details", "details_manquants"],
  title: "Triage2Schema",
  type: "object",
} as const;

const GET_DATA_FROM_WEB_TOOL = {
  user_location: {
    city: "Québec",
    country: "CA",
    region: "QC",
    type: "approximate",
  },
  search_context_size: "medium",
} as const;

const LEGACY_AGENT_DEFAULTS: Record<string, AgentParameters> = {
  triage: {
    instructions: TRIAGE_DEFAULT_INSTRUCTIONS,
    model: "gpt-5",
    model_settings: {
      store: true,
      reasoning: { effort: "minimal", summary: "auto" },
    },
    response_format: {
      type: "json_schema",
      json_schema: { name: "TriageSchema", schema: TRIAGE_RESPONSE_SCHEMA },
    },
  },
  r_dacteur: {
    instructions: R_DACTEUR_DEFAULT_INSTRUCTIONS,
    model: "gpt-4.1-mini",
    model_settings: {
      temperature: 1,
      top_p: 1,
      store: true,
    },
    response_format: {
      type: "json_schema",
      json_schema: { name: "RDacteurSchema", schema: R_DACTEUR_RESPONSE_SCHEMA },
    },
  },
  get_data_from_web: {
    instructions: GET_DATA_FROM_WEB_INSTRUCTIONS,
    model: "gpt-5-mini",
    model_settings: {
      store: true,
      reasoning: { effort: "medium", summary: "auto" },
    },
    tools: [
      {
        type: "web_search",
        web_search: {
          search_context_size: GET_DATA_FROM_WEB_TOOL.search_context_size,
          user_location: { ...GET_DATA_FROM_WEB_TOOL.user_location },
        },
      },
    ],
  },
  triage_2: {
    instructions: TRIAGE_2_INSTRUCTIONS,
    model: "gpt-5",
    model_settings: {
      store: true,
      reasoning: { effort: "minimal", summary: "auto" },
    },
    response_format: {
      type: "json_schema",
      json_schema: { name: "Triage2Schema", schema: TRIAGE_2_RESPONSE_SCHEMA },
    },
  },
  get_data_from_user: {
    instructions: GET_DATA_FROM_USER_INSTRUCTIONS,
    model: "gpt-5-nano",
    model_settings: {
      store: true,
      reasoning: { effort: "medium", summary: "auto" },
    },
  },
};

const cloneParameters = (source: AgentParameters | null | undefined): AgentParameters => {
  if (!source || !isPlainRecord(source)) {
    return {};
  }
  return JSON.parse(JSON.stringify(source)) as AgentParameters;
};

const STATE_PRESETS: Record<
  string,
  { scope: StateAssignmentScope; assignments: readonly StateAssignment[] }
> = {
  "maj-etat-triage": {
    scope: "state",
    assignments: [
      {
        target: "state.has_all_details",
        expression: "input.output_parsed.has_all_details",
      },
      {
        target: "state.infos_manquantes",
        expression: "input.output_text",
      },
      {
        target: "state.should_finalize",
        expression: "input.output_parsed.has_all_details",
      },
    ] as const,
  },
  "maj-etat-validation": {
    scope: "state",
    assignments: [
      {
        target: "state.has_all_details",
        expression: "input.output_parsed.has_all_details",
      },
      {
        target: "state.infos_manquantes",
        expression: "input.output_text",
      },
      {
        target: "state.should_finalize",
        expression: "input.output_parsed.has_all_details",
      },
    ] as const,
  },
};

const isStateAssignment = (value: unknown): value is StateAssignment =>
  isPlainRecord(value) && typeof value.target === "string" && typeof value.expression === "string";

const normalizeAssignments = (
  defaults: readonly StateAssignment[],
  overrides: unknown,
): StateAssignment[] => {
  const base = new Map<string, string>();
  for (const assignment of defaults) {
    base.set(assignment.target, assignment.expression);
  }

  if (Array.isArray(overrides)) {
    for (const entry of overrides) {
      if (!isStateAssignment(entry)) {
        continue;
      }
      const target = entry.target.trim();
      if (!base.has(target)) {
        continue;
      }
      base.set(target, entry.expression.trim());
    }
  }

  return defaults.map((assignment) => ({
    target: assignment.target,
    expression: base.get(assignment.target) ?? assignment.expression,
  }));
};

const mergeModelSettings = (
  defaults: Record<string, unknown> | undefined,
  overrides: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!defaults && !overrides) {
    return undefined;
  }

  const base = { ...(defaults ?? {}) } as Record<string, unknown>;

  if (!overrides) {
    return base;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (key === "reasoning" && isPlainRecord(value)) {
      const defaultReasoning = isPlainRecord(base.reasoning)
        ? { ...(base.reasoning as Record<string, unknown>) }
        : {};
      base.reasoning = { ...defaultReasoning, ...value };
    } else if (value === null || value === undefined) {
      delete base[key];
    } else {
      base[key] = value;
    }
  }

  if (Object.keys(base).length === 0) {
    return undefined;
  }

  return base;
};

const mergeAgentParameters = (
  defaults: AgentParameters,
  overrides: AgentParameters,
): AgentParameters => {
  const result = cloneParameters(defaults);
  if (Object.keys(overrides).length === 0) {
    return result;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (key === "model_settings") {
      if (isPlainRecord(value) || value === null || value === undefined) {
        const merged = mergeModelSettings(
          isPlainRecord(result.model_settings)
            ? (result.model_settings as Record<string, unknown>)
            : undefined,
          isPlainRecord(value) ? (value as Record<string, unknown>) : undefined,
        );
        if (merged) {
          result.model_settings = merged;
        } else {
          delete result.model_settings;
        }
      } else {
        result.model_settings = value;
      }
      continue;
    }

    if (value === undefined) {
      continue;
    }

    if (value === null) {
      delete result[key];
      continue;
    }

    result[key] = value;
  }

  return result;
};

export const resolveAgentParameters = (
  agentKey: string | null | undefined,
  rawParameters: AgentParameters | null | undefined,
): AgentParameters => {
  const overrides = cloneParameters(rawParameters);
  if (!agentKey) {
    return overrides;
  }

  const defaults = LEGACY_AGENT_DEFAULTS[agentKey];
  if (!defaults) {
    return overrides;
  }

  return mergeAgentParameters(defaults, overrides);
};

export const resolveStateParameters = (
  slug: string,
  rawParameters: AgentParameters | null | undefined,
): AgentParameters => {
  const overrides = cloneParameters(rawParameters);
  const preset = STATE_PRESETS[slug];
  if (!preset) {
    return overrides;
  }

  const mergedAssignments = normalizeAssignments(
    preset.assignments,
    (overrides as Record<string, unknown>)[preset.scope],
  );

  (overrides as Record<string, unknown>)[preset.scope] = mergedAssignments;

  return overrides;
};

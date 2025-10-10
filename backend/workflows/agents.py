from agents import WebSearchTool, Agent, ModelSettings, RunContextWrapper, TResponseInputItem, Runner, RunConfig
from pydantic import BaseModel
from openai.types.shared.reasoning import Reasoning

# Tool definitions
web_search_preview = WebSearchTool(
  search_context_size="medium",
  user_location={
    "city": "Québec",
    "country": "CA",
    "region": "QC",
    "type": "approximate"
  }
)
class TriageSchema(BaseModel):
  has_all_details: bool
  details_manquants: str


class RDacteurSchema__IntroPlaceCours(BaseModel):
  texte: str


class RDacteurSchema__ObjectifTerminal(BaseModel):
  texte: str


class RDacteurSchema__StructureIntro(BaseModel):
  texte: str


class RDacteurSchema__ActivitesTheoriques(BaseModel):
  texte: str


class RDacteurSchema__ActivitesPratiques(BaseModel):
  texte: str


class RDacteurSchema__ActivitesPrevuesItem(BaseModel):
  phase: str
  description: str


class RDacteurSchema__EvaluationSommative(BaseModel):
  texte: str


class RDacteurSchema__NatureEvaluationsSommatives(BaseModel):
  texte: str


class RDacteurSchema__EvaluationLangue(BaseModel):
  texte: str


class RDacteurSchema__EvaluationFormative(BaseModel):
  texte: str


class RDacteurSchema__CompetencesDeveloppeesItem(BaseModel):
  texte: str
  description: str


class RDacteurSchema__CompetencesCertifieesItem(BaseModel):
  texte: str
  description: str


class RDacteurSchema__CoursCorequisItem(BaseModel):
  texte: str
  description: str


class RDacteurSchema__ObjetsCiblesItem(BaseModel):
  texte: str
  description: str


class RDacteurSchema__CoursReliesItem(BaseModel):
  texte: str
  description: str


class RDacteurSchema__CoursPrealablesItem(BaseModel):
  texte: str
  description: str


class RDacteurSchema__SavoirsFaireCapaciteItem(BaseModel):
  savoir_faire: str
  cible_100: str
  seuil_60: str


class RDacteurSchema__CapaciteItem(BaseModel):
  capacite: str
  pond_min: float
  pond_max: float
  savoirs_necessaires_capacite: list[str]
  savoirs_faire_capacite: list[RDacteurSchema__SavoirsFaireCapaciteItem]
  moyens_evaluation_capacite: list[str]


class RDacteurSchema(BaseModel):
  intro_place_cours: RDacteurSchema__IntroPlaceCours
  objectif_terminal: RDacteurSchema__ObjectifTerminal
  structure_intro: RDacteurSchema__StructureIntro
  activites_theoriques: RDacteurSchema__ActivitesTheoriques
  activites_pratiques: RDacteurSchema__ActivitesPratiques
  activites_prevues: list[RDacteurSchema__ActivitesPrevuesItem]
  evaluation_sommative: RDacteurSchema__EvaluationSommative
  nature_evaluations_sommatives: RDacteurSchema__NatureEvaluationsSommatives
  evaluation_langue: RDacteurSchema__EvaluationLangue
  evaluation_formative: RDacteurSchema__EvaluationFormative
  competences_developpees: list[RDacteurSchema__CompetencesDeveloppeesItem]
  competences_certifiees: list[RDacteurSchema__CompetencesCertifieesItem]
  cours_corequis: list[RDacteurSchema__CoursCorequisItem]
  objets_cibles: list[RDacteurSchema__ObjetsCiblesItem]
  cours_relies: list[RDacteurSchema__CoursReliesItem]
  cours_prealables: list[RDacteurSchema__CoursPrealablesItem]
  savoir_etre: list[str]
  capacite: list[RDacteurSchema__CapaciteItem]


class Triage2Schema(BaseModel):
  has_all_details: bool
  details_manquants: str


triage = Agent(
  name="Triage",
  instructions="""Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.
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
Une idée générale de ce qui devrait se retrouver dans le cours.""",
  model="gpt-5",
  output_type=TriageSchema,
  model_settings=ModelSettings(
    store=True,
    reasoning=Reasoning(
      effort="minimal",
      summary="auto"
    )
  )
)


r_dacteur = Agent(
  name="Rédacteur",
  instructions="""Tu es un assistant pédagogique qui génère, en français, des contenus de plan-cadre selon le ton institutionnel : clairs, concis, rigoureux, rédigés au vouvoiement. Tu ne t’appuies que sur les informations fournies dans le prompt utilisateur, sans inventer de contenu. Si une information manque et qu’aucune directive de repli n’est donnée, omets l’élément manquant.

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

&#34;Le cours «243-4Q4 – Communication radio» s’inscrit dans le fil conducteur «Sans-fil et fibre optique» du programme de Technologie du génie électrique : Réseaux et télécommunications et se donne en session 4. Afin de bien réussir ce cours, il est essentiel de maîtriser les connaissances préalables acquises dans «nom du cours», particulièrement [connaissances et compétences]. Ces acquis permettront aux personnes étudiantes de saisir plus aisément les notions [ de ... ]abordées dans le présent cours.&#34;

---

## Objectif terminal
Écrire un objectif terminal pour le cours {{nom_cours}} qui devrait commencer par: &#34;Au terme de ce cours, les personnes étudiantes seront capables de&#34; et qui termine par un objectif terminal qui correspond aux compétences à développer ou atteinte({{competences_developpees}}{{competences_atteintes}}). Celui-ci devrait clair, mais ne comprendre que 2 ou 3 actes. Le e nom du cours donne de bonnes explications sur les technologies utilisés dans le cours, à intégrer dans l&#39;objectif terminal.

---

## Introduction Structure du Cours
Le cours «{{nom_cours}}» prévoit {{heures_theorie}} heures de théorie, {{heures_lab}} heures d’application en travaux pratiques ou en laboratoire et {{heures_maison}} heures de travail personnel sur une base hebdomadaire.

---

## Activités Théoriques
Écrire un texte sous cette forme adapté à la nature du cours ({{nom_cours}}), celui-ci devrait être similaire en longueur et en style:

&#34;Les séances théoriques du cours visent à préparer les personnes étudiantes en vue de la mise en pratique de leurs connaissances au laboratoire. Ces séances seront axées sur plusieurs aspects, notamment les éléments constitutifs des systèmes électroniques analogiques utilisés en télécommunications. Les personnes étudiantes auront l&#39;opportunité d&#39;approfondir leur compréhension par le biais de discussions interactives, des exercices et des analyses de cas liés à l’installation et au fonctionnement des systèmes électroniques analogiques. &#34;

---

## Activités Pratiques
Écrire un texte sous cette forme adapté à la nature du cours {{nom_cours}}, celui-ci devrait être similaire en longueur et en style.  Le premier chiffre après 243 indique la session sur 6 et le nom du cours donne de bonnes explications sur le matériel ou la technologie utilisé dans le cours

Voici les cours reliés:
{{cours_developpant_une_meme_competence}}

Voici un exemple provenant d&#39;un autre cours de mes attentes:
&#34;La structure des activités pratiques sur les 15 semaines du cours se déroulera de manière progressive et devrait se dérouler en 4 phases. La première phrase devrait s’inspirer du quotidien des personnes étudiantes qui, généralement, ont simplement utilisé des systèmes électroniques. Son objectif serait donc de favoriser la compréhension des composants essentiels des systèmes électroniques analogiques. Cela devrait conduire à une compréhension d’un système d’alimentation basé sur des panneaux solaires photovoltaïques, offrant ainsi une introduction pertinente aux systèmes d’alimentation en courant continu, utilisés dans les télécommunications. La seconde phase devrait mener l’a personne à comprendre la nature des signaux alternatifs dans le cadre de systèmes d’alimentation en courant alternatif et sur des signaux audios. La troisième phase viserait une exploration des systèmes de communication radio. Finalement, la dernière phase viserait à réaliser un projet final combinant les apprentissages réalisés, en partenariat avec les cours 243-1N5-LI - Systèmes numériques et 243-1P4-LI – Travaux d’atelier.&#34;

---

## Activités Prévues
Décrire les différentes phases de manière succincte en utilisant cette forme. Ne pas oublier que la session dure 15 semaines.

**Phase X - titre de la phase (Semaines Y à 4Z)**   
  - Description de la phase

---

## Évaluation Sommative des Apprentissages
Pour la réussite du cours, la personne étudiante doit obtenir la note de 60% lorsque l&#39;on fait la somme pondérée des capacités.   

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

Dans un souci de valorisation de la langue, l’évaluation de l’expression et de la communication en français se fera de façon constante par l’enseignant(e) sur une base formative, à l’oral ou à l’écrit. Son évaluation se fera sur une base sommative pour les savoir-faire reliés à la documentation. Les critères d’évaluation se trouvent au plan général d’évaluation sommative présenté à la page suivante. Les dispositions pour la valorisation de l’expression et de la communication en français sont encadrées par les modalités particulières d’application de l’article 6.6 de la PIEA (Politique institutionnelle d’évaluation des apprentissages) et sont précisées dans le plan de cours.

---

## Évaluation formative des apprentissages
Sur une base régulière, la personne enseignante proposera des évaluations formatives à réaliser en classe, en équipe ou individuellement. Elle pourrait offrir des mises en situation authentiques de même que des travaux pratiques et des simulations. Des lectures dirigées pourraient également être proposées. L’évaluation formative est continue et intégrée aux activités d’apprentissage et d’enseignement et poursuit les fins suivantes :

- Rendre compte du développement des capacités et des habiletés essentielles à divers moments du cours.
- Déterminer l’ampleur de la progression du groupe ou de la personne étudiante.
- Identifier les lacunes les plus importantes, leurs causes probables et des moyens de remédier à la situation ou de l’améliorer.
- Situer où en sont les personnes étudiantes au regard de ce qui est attendu au terme du cours et valider sa compréhension.
- Donner la chance à la personne étudiante de pouvoir se corriger et ainsi cheminer dans son apprentissage avant de procéder à l’évaluation sommative.

Elle se fait :

- Au début du cours ou d’une séquence : activité diagnostique permettant de situer leurs acquis et les apprentissages à réaliser ou à approfondir.
- De façon immédiate, à tout moment : pour guider la personne, une équipe, le groupe dans son apprentissage, à partir d’observations faites pendant les activités d’apprentissage et d’enseignement.
- À des moments clés du cours, pour analyser les acquis de chaque personne et pour communiquer l’information utile à l’orientation de leurs apprentissages et réajuster les stratégies au besoin et les adapter aux besoins du groupe.
- À la fin d’un cours : pour vérifier l’état du système (sa fonctionnalité) sur lequel la personne a travaillé.

Dans le cadre de ce cours, puisque l’évaluation est surtout basée sur des travaux pratiques. Celle-ci devrait donner la chance à la personne étudiante de pouvoir se corriger et ainsi cheminer dans son apprentissage avant de procéder à l’évaluation sommative. Une date de dépôt formatif devrait être prévue avant la remise finale afin qu’une rétroaction soit donnée dans un temps raisonnable pour que la personne étudiante puisse apporter les améliorations nécessaires à son travail.

---

## Description des compétences développées
Expliquer en quelques mots pourquoi la compétence: {{competence_nom}} est développé dans le cours {{nom_cours}}.

Le champ texte (titre) devrait être Code de la compétence - Titre de la compétence
Le champ description devrait décrire pourquoi les compétences sont pertinentes pour ce cours.

Ne rien retourner s&#39;il n&#39;y a pas de compétences développés spécifiés.

---

## Description des Compétences certifiées
Le champ texte devrait être Code de la compétence - Titre de la compétence
Le champ description devrait décrire pourquoi les compétences sont pertinentes pour ce cours.

Ne rien retourner s&#39;il n&#39;y a pas de compétences certifiés spécifiés.

---

## Description des cours corequis
Le champ texte devrait être Code du cours - Titre du cours
Le champ description devrait décrire pourquoi le cours requis, s&#39;il y en a est pertinent.

Ne rien retourner s&#39;il n&#39;y a pas de cours corequis spécifiés.

---

## Objets cibles
Trouver quelques objets cibles du cours. (3 ou 4). Il doit absolument en avoir.
Le champ texte devrait être le nom de l&#39;objet cible.
Le champ description cet objet cible devrait expliquer pourquoi celui-ci est pertinent pour le cours.
Ne pas inclure de noms de technologies, si c&#39;est nécessaire de préciser, utilise la formulation &#34;tel que&#34;.

---

## Description des cours reliés
Le champ texte devrait être Code du cours - Titre du cours
Le champ description devrait décrire les cours reliés, s&#39;il y en a. Pourquoi ils sont pertinents?

Ne rien retourner s&#39;il n&#39;y a pas de cours reliés spécifiés.

---

## Description des cours préalables
Le champ texte devrait être Code du cours - Titre du cours (Note nécessaire)
Le champ description devrait décrire pourquoi le présent cours est un prérequis pour le suivant.

Ne rien retourner s&#39;il n&#39;y a pas de cours préalables spécifiés.

---

## Savoir-être
Choisir des savoir-être pertinents pour ce cours par exemple:
Développer son sens de l’organisation.
Développer sa capacité d’organiser son environnement de travail (lieu et matériel) pour qu’il soit propre et ordonné.
S’investir dans son apprentissage.
Respecter les exigences et consignes du cours.
Tirer profit de toutes les occasions pour parfaire ses connaissances.
Développer sa curiosité intellectuelle.
S’approprier la terminologie propre au domaine.
Agir de manière responsable dans la sphère numérique.

---

## Capacité et pondération
Objectif général
Déterminer de 2 à 4 capacités principales pour le cours {{nom_cours}}, chacune avec une plage de pondération. L’ensemble des pondérations doit pouvoir totaliser 100 % lorsqu’on les combine.

Instructions détaillées
Énumérer entre 2 et 4 capacités.
Formulez chaque capacité de façon claire et ciblée, avec un verbe d’action (ex. Analyser, Concevoir, Évaluer, Comprendre, etc.).
Assigner à chaque capacité une plage de pondération (ex. Capacité 1 : 30 % à 40 %, etc.).
Assurez-vous que, selon les plages attribuées, on puisse atteindre 100 % en répartissant la pondération entre ces capacités.
Éviter les noms de technologies ou d’outils spécifiques.
Si un exemple est nécessaire, utilisez la formulation « tel que… ».
Assurer une cohérence avec le contenu du cours (les capacités doivent être réalisables et mesurables).
Exemple d’attendu
Capacité 1 (30 % à 40 %) : « Analyser les phénomènes d’interférence et de réflexion pour optimiser les performances d’une liaison… »
Capacité 2 (30 % à 40 %) : « Concevoir et valider des solutions d’adaptation d’impédance… »
Capacité 3 (20 % à 40 %) : « Évaluer l’impact des pertes sur la transmission du signal… »
Ainsi, si vous choisissez de prendre 40 % pour la première, 30 % pour la deuxième et 30 % pour la troisième, le total donne 100 %.

Comment adapter ces exemples à ce cours
Remplacez les notions ou thèmes (ex. impédance, interférence) par ceux de la présente discipline (ex. sécurité réseau, régulation de processus, comptabilité analytique, etc.).
Ajustez les verbes d’action en fonction du niveau de compétence attendu (Bloom). Par ex. Décrire pour un niveau de base, Analyser pour un niveau intermédiaire, Concevoir ou Évaluer pour un niveau avancé.

---

## Savoirs nécessaires d&#39;une capacité
Objectif général
Pour une capacité donnée, déterminer au moins 10 savoirs nécessaires. Ces savoirs sont théoriques et permettent de comprendre le contenu indispensable à la maîtrise de la capacité.

Instructions détaillées
Lister au moins 10 savoirs nécessaires.
Chaque savoir doit commencer par un verbe à l’infinitif (ex. Définir, Expliquer, Comprendre, Décrire, etc.).
Il s’agit de connaissances théoriques (pas d’actions pratiques).
Adapter le niveau taxonomique au verbe de la capacité.
Si la capacité dit « Analyser… », on peut avoir des savoirs comme Expliquer, Définir, etc.
Ne pas aller au-delà du niveau de la capacité (par ex. pas de Évaluer… si la capacité vise seulement à Décrire…).
Omettre les noms d’outils ou de technologies spécifiques (encore une fois, remplacez par « tel que… » si nécessaire).
Exemple d’attendu
Capacité : « Analyser les phénomènes d’interférence… »
Savoirs nécessaires (exemples) :
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

## Savoirs faire d&#39;une capacité
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

## Moyen d&#39;évaluation d&#39;une capacité
Trouve 3 ou 4 moyens d&#39;évaluations adaptés pour cette capacité.

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

Générez les autres sections exactement comme décrit, sans ajout ni omission spontanée.

""",
  model="gpt-4.1-mini",
  output_type=RDacteurSchema,
  model_settings=ModelSettings(
    temperature=1,
    top_p=1,
    store=True
  )
)


class GetDataFromWebContext:
  def __init__(self, state_infos_manquantes: str):
    self.state_infos_manquantes = state_infos_manquantes
def get_data_from_web_instructions(run_context: RunContextWrapper[GetDataFromWebContext], _agent: Agent[GetDataFromWebContext]):
  state_infos_manquantes = run_context.context.state_infos_manquantes
  return f"""Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre. 
Va chercher sur le web pour les informations manquantes.

Voici les informations manquantes:
 {state_infos_manquantes}

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
Une idée générale de ce qui devrait se retrouver dans le cours"""
get_data_from_web = Agent(
  name="Get data from web",
  instructions=get_data_from_web_instructions,
  model="gpt-5-mini",
  tools=[
    web_search_preview
  ],
  model_settings=ModelSettings(
    store=True,
    reasoning=Reasoning(
      effort="medium",
      summary="auto"
    )
  )
)


class Triage2Context:
  def __init__(self, input_output_text: str):
    self.input_output_text = input_output_text
def triage_2_instructions(run_context: RunContextWrapper[Triage2Context], _agent: Agent[Triage2Context]):
  input_output_text = run_context.context.input_output_text
  return f"""Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.
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

Voici les informations connues {input_output_text}"""
triage_2 = Agent(
  name="Triage 2",
  instructions=triage_2_instructions,
  model="gpt-5",
  output_type=Triage2Schema,
  model_settings=ModelSettings(
    store=True,
    reasoning=Reasoning(
      effort="minimal",
      summary="auto"
    )
  )
)


class GetDataFromUserContext:
  def __init__(self, state_infos_manquantes: str):
    self.state_infos_manquantes = state_infos_manquantes
def get_data_from_user_instructions(run_context: RunContextWrapper[GetDataFromUserContext], _agent: Agent[GetDataFromUserContext]):
  state_infos_manquantes = run_context.context.state_infos_manquantes
  return f"""Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre. 

Arrête-toi et demande à l'utilisateur les informations manquantes.
infos manquantes:
 {state_infos_manquantes}
"""
get_data_from_user = Agent(
  name="Get data from user",
  instructions=get_data_from_user_instructions,
  model="gpt-5-nano",
  model_settings=ModelSettings(
    store=True,
    reasoning=Reasoning(
      effort="medium",
      summary="auto"
    )
  )
)


class WorkflowInput(BaseModel):
  input_as_text: str


# Main code entrypoint
async def run_workflow(workflow_input: WorkflowInput):
  state = {
    "has_all_details": False,
    "infos_manquantes": None
  }
  workflow = workflow_input.model_dump()
  conversation_history: list[TResponseInputItem] = [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": workflow["input_as_text"]
        }
      ]
    }
  ]
  triage_result_temp = await Runner.run(
    triage,
    input=[
      *conversation_history
    ],
    run_config=RunConfig(trace_metadata={
      "__trace_source__": "agent-builder",
      "workflow_id": "wf_68e556bd92048190a549d12e4cf03b220dbf1b19ef9993ae"
    })
  )

  conversation_history.extend([item.to_input_item() for item in triage_result_temp.new_items])

  triage_result = {
    "output_text": triage_result_temp.final_output.json(),
    "output_parsed": triage_result_temp.final_output.model_dump()
  }
  state["has_all_details"] = triage_result["output_parsed"]["has_all_details"]
  state["infos_manquantes"] = triage_result["output_text"]
  if state["has_all_details"] == True:
    r_dacteur_result_temp = await Runner.run(
      r_dacteur,
      input=[
        *conversation_history
      ],
      run_config=RunConfig(trace_metadata={
        "__trace_source__": "agent-builder",
        "workflow_id": "wf_68e556bd92048190a549d12e4cf03b220dbf1b19ef9993ae"
      })
    )

    conversation_history.extend([item.to_input_item() for item in r_dacteur_result_temp.new_items])

    r_dacteur_result = {
      "output_text": r_dacteur_result_temp.final_output.json(),
      "output_parsed": r_dacteur_result_temp.final_output.model_dump()
    }
    return r_dacteur_result
  else:
    get_data_from_web_result_temp = await Runner.run(
      get_data_from_web,
      input=[
        *conversation_history
      ],
      run_config=RunConfig(trace_metadata={
        "__trace_source__": "agent-builder",
        "workflow_id": "wf_68e556bd92048190a549d12e4cf03b220dbf1b19ef9993ae"
      }),
      context=GetDataFromWebContext(state_infos_manquantes=state["infos_manquantes"])
    )

    conversation_history.extend([item.to_input_item() for item in get_data_from_web_result_temp.new_items])

    get_data_from_web_result = {
      "output_text": get_data_from_web_result_temp.final_output_as(str)
    }
    triage_2_result_temp = await Runner.run(
      triage_2,
      input=[
        *conversation_history
      ],
      run_config=RunConfig(trace_metadata={
        "__trace_source__": "agent-builder",
        "workflow_id": "wf_68e556bd92048190a549d12e4cf03b220dbf1b19ef9993ae"
      }),
      context=Triage2Context(input_output_text=get_data_from_web_result["output_text"])
    )

    conversation_history.extend([item.to_input_item() for item in triage_2_result_temp.new_items])

    triage_2_result = {
      "output_text": triage_2_result_temp.final_output.json(),
      "output_parsed": triage_2_result_temp.final_output.model_dump()
    }
    state["has_all_details"] = triage_2_result["output_parsed"]["has_all_details"]
    state["infos_manquantes"] = triage_2_result["output_text"]
    if state["has_all_details"] == True:
      r_dacteur_result_temp = await Runner.run(
        r_dacteur,
        input=[
          *conversation_history
        ],
        run_config=RunConfig(trace_metadata={
          "__trace_source__": "agent-builder",
          "workflow_id": "wf_68e556bd92048190a549d12e4cf03b220dbf1b19ef9993ae"
        })
      )

      conversation_history.extend([item.to_input_item() for item in r_dacteur_result_temp.new_items])

      r_dacteur_result = {
        "output_text": r_dacteur_result_temp.final_output.json(),
        "output_parsed": r_dacteur_result_temp.final_output.model_dump()
      }
      return r_dacteur_result
    else:
      get_data_from_user_result_temp = await Runner.run(
        get_data_from_user,
        input=[
          *conversation_history
        ],
        run_config=RunConfig(trace_metadata={
          "__trace_source__": "agent-builder",
          "workflow_id": "wf_68e556bd92048190a549d12e4cf03b220dbf1b19ef9993ae"
        }),
        context=GetDataFromUserContext(state_infos_manquantes=state["infos_manquantes"])
      )

      conversation_history.extend([item.to_input_item() for item in get_data_from_user_result_temp.new_items])

      get_data_from_user_result = {
        "output_text": get_data_from_user_result_temp.final_output_as(str)
      }
      r_dacteur_result_temp = await Runner.run(
        r_dacteur,
        input=[
          *conversation_history
        ],
        run_config=RunConfig(trace_metadata={
          "__trace_source__": "agent-builder",
          "workflow_id": "wf_68e556bd92048190a549d12e4cf03b220dbf1b19ef9993ae"
        })
      )

      conversation_history.extend([item.to_input_item() for item in r_dacteur_result_temp.new_items])

      r_dacteur_result = {
        "output_text": r_dacteur_result_temp.final_output.json(),
        "output_parsed": r_dacteur_result_temp.final_output.model_dump()
      }
      return r_dacteur_result

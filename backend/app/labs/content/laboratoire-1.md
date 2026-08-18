# Laboratoire 1 - Appropriation de l'environnement de travail

## Objectifs

À la fin de ce laboratoire, vous serez en mesure de :

- repérer et identifier les principaux appareils de votre table de travail;
- mesurer une tension et une résistance avec un multimètre;
- configurer une alimentation continue à deux canaux;
- produire et observer un signal avec un générateur de fonctions et un oscilloscope;
- recevoir et observer des signaux radio avec un HackRF et SDR Console.

## Consignes générales

- Présentez votre carte étudiante lors de tout emprunt au magasin.
- Vérifiez l'état du matériel avant de commencer.
- Demandez une validation à la personne enseignante aux étapes indiquées.
- À la fin du laboratoire, remettez les appareils à leur configuration par défaut, rangez les câbles et rapportez le matériel emprunté.

## Matériel à récupérer

| Lieu | Matériel |
|---|---|
| Au magasin | Sondes pour multimètre; câbles banane-alligator; kit de sondes d'oscilloscope; câble BNC-alligator; module HackRF; antenne adaptée; câble USB |
| Fourni en classe | Une pile |
| En libre-service dans le corridor | Résistances de 150 Ω, 1,5 kΩ, 15 kΩ et 150 kΩ |

---

# Partie A - Multimètre et alimentation continue

## 1. Identification des appareils

Identifiez les appareils présents sur votre table. Pour chacun, notez la marque, le modèle et la fonction principale.

{{ table id="appareils" label="Identification des appareils" columns="marque:Marque:text|modele:Modèle:text|fonction:Fonction principale:text" rows="multimetre:Multimètre|oscilloscope:Oscilloscope|generateur:Générateur de fonctions|alimentation:Alimentation continue|ordinateur:Ordinateur|autre:Autre" required=true }}

## 2. Première mesure de tension

- Mettez le multimètre en marche.
- Branchez le fil rouge sur la borne `VΩ` et le fil noir sur la borne `COM`.
- Activez le mode de mesure de tension continue (`DCV`).
- Mesurez la tension aux bornes de la pile en respectant les polarités : rouge sur `+`, noir sur `-`.
- Inversez ensuite les fils et mesurez de nouveau.

{{ table id="tensions_pile" label="Première mesure de tension" columns="tension:Tension mesurée:number:V" rows="normale:Rouge sur +, noir sur -|inversee:Fils inversés" required=true }}

**Que change l'inversion des fils?**

{{ textarea id="effet_inversion" label="Que change l'inversion des fils?" rows=3 required=true }}

## 3. Configuration de l'alimentation Siglent SPD3303C

- Allumez l'alimentation.
- Vérifiez que les canaux sont en mode indépendant : les modes `SER` et `PARA` doivent être désactivés.
- Réglez le canal 1 (`CH1`) à 10 V avec une limite de courant de 1 A.
- Réglez le canal 2 (`CH2`) à 4 V avec une limite de courant de 1 A.
- Appuyez sur `ALL ON/OFF` pour activer les sorties.
- Mesurez chaque canal avec le multimètre.

| Mesure | CH1 | CH2 |
|---|---:|---:|
| Tension réglée (V) | 10 | 4 |

{{ table id="alimentation_mesures" label="Tensions mesurées" columns="ch1:CH1:number:V|ch2:CH2:number:V" rows="tension:Tension mesurée" required=true }}

## 4. Mesures différentielles en mode série

- Activez le mode `SER`.
- Observez l'affichage des deux canaux.
- Faites varier la tension de `CH1` et observez l'effet sur `CH2`.

**Observations :**

{{ textarea id="serie_observation" label="Observations en mode série" rows=3 required=true }}

Prenez ensuite les mesures suivantes. Une mesure entre un point de référence (sonde noire) et un point de mesure (sonde rouge) correspond à `Vrouge - Vnoire`.

{{ table id="mesures_differentielles_liste" label="Les 16 mesures différentielles" columns="no:No:readonly|noire:Sonde noire:readonly|rouge:Sonde rouge:readonly|tension:Tension mesurée:number:V" rows="m01:1 — CH1 (-) → CH1 (-)|m02:2 — CH1 (-) → CH1 (+)|m03:3 — CH1 (-) → CH2 (-)|m04:4 — CH1 (-) → CH2 (+)|m05:5 — CH1 (+) → CH1 (-)|m06:6 — CH1 (+) → CH1 (+)|m07:7 — CH1 (+) → CH2 (-)|m08:8 — CH1 (+) → CH2 (+)|m09:9 — CH2 (-) → CH1 (-)|m10:10 — CH2 (-) → CH1 (+)|m11:11 — CH2 (-) → CH2 (-)|m12:12 — CH2 (-) → CH2 (+)|m13:13 — CH2 (+) → CH1 (-)|m14:14 — CH2 (+) → CH1 (+)|m15:15 — CH2 (+) → CH2 (-)|m16:16 — CH2 (+) → CH2 (+)" required=true visible_columns="tension" }}

Reportez les résultats dans la matrice. Les lignes représentent la sonde noire et les colonnes, la sonde rouge.

{{ matrix id="mesures_differentielles" label="Matrice des tensions différentielles" columns="ch1_moins:CH1 (-):number:V|ch1_plus:CH1 (+):number:V|ch2_moins:CH2 (-):number:V|ch2_plus:CH2 (+):number:V" rows="ch1_moins:CH1 (-)|ch1_plus:CH1 (+)|ch2_moins:CH2 (-)|ch2_plus:CH2 (+)" required=true }}

**Quelles relations remarquez-vous entre les mesures opposées et les mesures prises entre deux points identiques?**

{{ textarea id="relations_mesures" label="Quelles relations remarquez-vous entre les mesures opposées et les mesures prises entre deux points identiques?" rows=4 required=true }}

## 5. Variation de la tension

- Désactivez le mode `SER` pour replacer les canaux en mode indépendant.
- Rebranchez le multimètre aux bornes de `CH1`.
- Faites varier la tension réglée et observez la lecture du multimètre.

**Quel lien observez-vous entre la valeur réglée et la valeur mesurée?**

{{ textarea id="variation_tension" label="Quel lien observez-vous entre la valeur réglée et la valeur mesurée?" rows=3 required=true }}

## 6. Mesure d'une résistance

- Désactivez toute alimentation du circuit avant de mesurer une résistance.
- Sélectionnez la fonction ohmmètre (`Ω`) du multimètre.
- Observez l'affichage lorsque les deux pointes de touche se touchent, puis lorsqu'elles sont séparées.

{{ table id="etat_sondes" label="Résistance selon l'état des sondes" columns="resistance:Résistance affichée:text" rows="contact:Sondes en contact (circuit fermé)|separees:Sondes séparées (circuit ouvert)" required=true }}

Mesurez ensuite les résistances demandées et relevez leur code de couleurs.

{{ table id="resistances" label="Mesure et code de couleurs" columns="mesure:Valeur mesurée:number:Ω|couleur1:Couleur 1:color|couleur2:Couleur 2:color|couleur3:Couleur 3:color|tolerance:Tolérance:select:or;argent;brun;rouge;vert;bleu;violet" rows="r150:150 Ω|r1k5:1,5 kΩ|r15k:15 kΩ|r150k:150 kΩ" required=true }}

---

# Partie B - Générateur de fonctions et oscilloscope

## 1. Branchement initial

- Repérez l'oscilloscope et le générateur de fonctions sur votre table.
- Allumez les deux appareils.
- Remettez l'oscilloscope à ses paramètres par défaut avec le bouton `Default`.
- Branchez une sonde sur le canal 1 (`CH1`) de l'oscilloscope.
- Placez l'atténuation de la sonde à `1X`.
- Branchez le câble BNC-alligator sur le canal 1 du générateur de fonctions.
- Reliez la pince rouge à la pointe de mesure de la sonde et la pince noire à sa masse (`Ground`).

## 2. Configuration du générateur

- Sélectionnez le canal 1 du générateur.
- Activez sa sortie (`Output: On`).
- Réglez la charge de sortie à haute impédance (`High Z`).
- Configurez un signal sinusoïdal :

| Paramètre | Valeur |
|---|---:|
| Forme | Sinusoïdale |
| Fréquence | 1 kHz |
| Amplitude | 1 Vpp |
| Décalage (`Offset`) | 0 V |

- Appuyez sur `Auto-Setup` sur l'oscilloscope.
- Faites valider l'écran par la personne enseignante.

{{ teacher_validation id="validation_enseignant" label="Configuration initiale validée par la personne enseignante" required=true }}

## 3. Exploration des paramètres du signal

Modifiez un seul paramètre à la fois, observez l'écran, puis revenez à la valeur initiale avant de poursuivre.

### Fréquence

Faites varier la fréquence de 1 kHz à 3 kHz.

**Que change-t-il à l'écran?**

{{ textarea id="effet_frequence" label="Que change la fréquence à l'écran?" rows=3 required=true }}

### Amplitude

Faites varier l'amplitude entre 200 mVpp et 1 Vpp, puis revenez à 1 Vpp.

**Que change-t-il à l'écran?**

{{ textarea id="effet_amplitude" label="Que change l'amplitude à l'écran?" rows=3 required=true }}

### Décalage

Faites varier le décalage de 0 mV à 200 mV, puis revenez à 0 V.

**Que change-t-il à l'écran?**

{{ textarea id="effet_decalage" label="Que change le décalage à l'écran?" rows=3 required=true }}

### Forme d'onde

Essayez les différentes formes d'onde offertes par le générateur, puis revenez à une sinusoïde.

**Que change-t-il à l'écran?**

{{ textarea id="effet_forme" label="Que change la forme d'onde à l'écran?" rows=3 required=true }}

## 4. Mesures automatiques

- Repérez la mesure de fréquence affichée par l'oscilloscope.
- Appuyez sur `Measure` et ajoutez la mesure d'amplitude crête à crête.

{{ table id="mesures_oscilloscope" label="Mesures automatiques" columns="reglee:Valeur réglée:readonly|mesuree:Valeur mesurée:number" rows="frequence:Fréquence — 1 kHz|amplitude:Amplitude — 1 Vpp" required=true visible_columns="mesuree" }}

---

# Partie C - Réception radio avec HackRF

Cette partie du laboratoire se déroule dans la tour de télécom.

## Préparation du logiciel

Avant le laboratoire, téléchargez et installez la **dernière version stable 64 bits** de [SDR Console depuis le site officiel](https://www.sdr-radio.com/download#Release).

## 1. Réception d'une station FM commerciale

- Branchez le HackRF à l'ordinateur et raccordez son antenne.
- Ouvrez SDR Console.
- Dans `Definitions`, cliquez sur `Search`, puis sélectionnez `HackRF`.
- Sélectionnez l'appareil détecté, cliquez sur `Add`, puis sur `Save`.
- Dans `Select Radio`, choisissez le HackRF, une largeur de bande de 8 MHz, puis cliquez sur `Start`.
- Syntonisez une station FM locale, par exemple 102,1 MHz.
- Choisissez la modulation `BC-FM` (`Broadcast FM`).
- Ajustez le gain et le volume au besoin.
- Expérimentez avec d'autres stations FM locales.

{{ table id="stations_fm" label="Stations FM reçues" columns="frequence:Fréquence:number:MHz|niveau:Niveau observé:text|qualite:Qualité audio:select:faible;moyenne;bonne;excellente" rows="station1:Station 1|station2:Station 2|station3:Station 3" required=true }}

## 2. Observation de signaux NFM

La modulation FM étroite (`NFM`) est utilisée pour certaines communications vocales. Elle occupe généralement une bande plus étroite que la radiodiffusion musicale `BC-FM`.

- Sélectionnez la modulation `NFM`.
- Explorez uniquement les fréquences dont l'écoute est permise et indiquées par la personne enseignante.
- Observez la largeur des signaux et comparez-la à celle d'une station `BC-FM`.
- N'émettez aucun signal : le HackRF est utilisé ici uniquement en réception.

{{ table id="signaux_nfm" label="Signaux NFM observés" columns="frequence:Fréquence:number:MHz|largeur:Largeur approximative:number:kHz|observation:Observation:text" rows="meteo:Station météo ou fréquence autorisée|classe:Autre fréquence indiquée en classe" required=true }}

**Quelle différence visuelle observez-vous entre un signal NFM et une station BC-FM?**

{{ textarea id="difference_nfm_bcfm" label="Quelle différence visuelle observez-vous entre un signal NFM et une station BC-FM?" rows=4 required=true }}

## Conclusion du laboratoire

Résumez en quelques phrases ce que chacun des trois instruments vous permet d'observer ou de mesurer.

{{ table id="conclusion_instruments" label="Conclusion du laboratoire" columns="phenomene:Grandeur ou phénomène observé:text" rows="multimetre:Multimètre|oscilloscope:Oscilloscope|hackrf:HackRF avec SDR Console" required=true }}

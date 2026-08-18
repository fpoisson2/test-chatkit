# Laboratoire 1 - Appropriation de l'environnement de travail

## Objectifs

À la fin de ce laboratoire, vous serez en mesure d'identifier les appareils du poste, de mesurer une tension et une résistance, d'observer un signal et de recevoir des signaux radio. Conservez les unités et le bon nombre de chiffres significatifs.

# Partie A - Multimètre et alimentation continue

## 1. Identification des appareils

Identifiez les appareils présents sur votre table.

{{ table id="appareils" label="Identification des appareils" columns="marque:Marque|modele:Modèle|fonction:Fonction principale" rows="multimetre:Multimètre|oscilloscope:Oscilloscope|generateur:Générateur de fonctions|alimentation:Alimentation continue|ordinateur:Ordinateur|autre:Autre" required=true }}

## 2. Première mesure de tension

Branchez le rouge sur `VΩ`, le noir sur `COM`, activez `DCV`, puis mesurez la pile dans les deux polarités.

{{ number id="pile_polarite_normale" label="Rouge sur +, noir sur -" unit="V" required=true step="any" }}

{{ number id="pile_polarite_inversee" label="Fils inversés" unit="V" required=true step="any" }}

{{ textarea id="effet_inversion" label="Que change l'inversion des fils?" rows=3 required=true }}

## 3. Configuration de l'alimentation Siglent SPD3303C

Réglez CH1 à 10 V et CH2 à 4 V, avec une limite de 1 A, puis mesurez chaque canal.

{{ table id="alimentation_mesures" label="Mesures de l'alimentation" columns="ch1:CH1|ch2:CH2" rows="tension_mesuree:Tension mesurée (V)" required=true }}

## 4. Mesures différentielles en mode série

Activez `SER`. Une mesure correspond à `Vrouge - Vnoire`.

{{ textarea id="serie_observation" label="Que remarquez-vous à l'affichage lorsque CH1 varie?" rows=3 required=true }}

{{ matrix id="mesures_differentielles" label="Tensions différentielles (V)" columns="ch1_moins:CH1 (-)|ch1_plus:CH1 (+)|ch2_moins:CH2 (-)|ch2_plus:CH2 (+)" rows="ch1_moins:CH1 (-)|ch1_plus:CH1 (+)|ch2_moins:CH2 (-)|ch2_plus:CH2 (+)" required=true }}

{{ textarea id="relations_mesures" label="Quelles relations remarquez-vous entre les mesures opposées et les points identiques?" rows=4 required=true }}

## 5. Variation de la tension

{{ textarea id="variation_tension" label="Quel lien observez-vous entre la valeur réglée et la valeur mesurée?" rows=3 required=true }}

## 6. Mesure d'une résistance

Coupez toute alimentation avant d'utiliser l'ohmmètre.

{{ table id="etat_sondes" label="Résistance selon l'état des sondes" columns="resistance:Résistance affichée" rows="contact:Sondes en contact|separees:Sondes séparées" required=true }}

{{ table id="resistances" label="Mesure et code de couleurs" columns="mesure:Valeur mesurée|couleur1:Couleur 1|couleur2:Couleur 2|couleur3:Couleur 3|tolerance:Tolérance" rows="r150:150 Ω|r1k5:1,5 kΩ|r15k:15 kΩ|r150k:150 kΩ" required=true }}

# Partie B - Générateur de fonctions et oscilloscope

Branchez le générateur à l'oscilloscope. Configurez la sortie en mode `High Z`, puis utilisez les paramètres suivants avant d'appuyer sur `Auto-Setup`.

| Paramètre | Valeur |
|---|---:|
| Forme | Sinusoïdale |
| Fréquence | 1 kHz |
| Amplitude | 1 Vpp |
| Décalage (`Offset`) | 0 V |

{{ teacher_validation id="validation_enseignant" label="Validation de la personne enseignante (initiales ou commentaire)" required=true }}

## Exploration des paramètres

Modifiez un seul paramètre à la fois et revenez à la configuration initiale.

{{ textarea id="effet_frequence" label="Effet du passage de 1 kHz à 3 kHz" rows=3 required=true }}
{{ textarea id="effet_amplitude" label="Effet du passage de 200 mVpp à 1 Vpp" rows=3 required=true }}
{{ textarea id="effet_decalage" label="Effet du passage de 0 mV à 200 mV" rows=3 required=true }}
{{ textarea id="effet_forme" label="Différences observées entre les formes d'onde" rows=3 required=true }}

{{ table id="mesures_oscilloscope" label="Mesures automatiques" columns="valeur_mesuree:Valeur mesurée|ecart:Écart" rows="frequence:Fréquence (réglée à 1 kHz)|amplitude:Amplitude (réglée à 1 Vpp)" required=true }}

# Partie C - Réception radio avec HackRF

Utilisez le HackRF uniquement en réception. Dans SDR Console, ajoutez l'appareil, sélectionnez une bande de 8 MHz et explorez seulement les fréquences permises.

## Stations FM commerciales

{{ table id="stations_fm" label="Stations FM reçues" columns="frequence:Fréquence (MHz)|niveau:Niveau observé|qualite:Qualité audio" rows="station1:Station 1|station2:Station 2|station3:Station 3" required=true }}

## Observation de signaux NFM

{{ table id="signaux_nfm" label="Signaux NFM observés" columns="frequence:Fréquence|largeur:Largeur approximative|observation:Observation" rows="meteo:Station météo ou fréquence autorisée|classe:Autre fréquence indiquée en classe" required=true }}

{{ textarea id="difference_nfm_bcfm" label="Quelle différence visuelle observez-vous entre un signal NFM et une station BC-FM?" rows=4 required=true }}

## Conclusion

{{ table id="conclusion_instruments" label="Phénomènes observés" columns="phenomene:Grandeur ou phénomène observé" rows="multimetre:Multimètre|oscilloscope:Oscilloscope|hackrf:HackRF avec SDR Console" required=true }}

{{ textarea id="instrument_diagnostic" label="Quel instrument semble le plus utile pour diagnostiquer un système analogique? Justifiez." rows=4 required=true }}

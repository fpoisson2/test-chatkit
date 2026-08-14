import type { LabActivity } from "./types";

export const demoLabActivity: LabActivity = {
  id: "chimie-acide-base",
  title: "Laboratoire — Dosage acido-basique",
  courseName: "Chimie générale · 243-4Q5-LI",
  introduction:
    "Documentez votre démarche, vos observations et votre interprétation. Les images de votre montage ou de vos résultats peuvent être ajoutées directement dans les zones prévues.",
  durationSeconds: 3 * 60 * 60,
  adaptiveQuestionsEnabled: true,
  maxAdaptiveQuestions: 2,
  criteria: [
    { id: "method", label: "Méthode expérimentale", description: "La démarche est complète et reproductible.", weight: 35, maxPoints: 35 },
    { id: "observations", label: "Observations et données", description: "Les observations sont précises et les données sont documentées.", weight: 30, maxPoints: 30 },
    { id: "analysis", label: "Analyse scientifique", description: "Les résultats sont interprétés avec un raisonnement scientifique.", weight: 35, maxPoints: 35 },
  ],
  sections: [
    {
      id: "preparation",
      title: "1. Préparation",
      description: "Présentez votre hypothèse et les éléments nécessaires avant de commencer.",
      fields: [
        { id: "hypothesis", label: "Hypothèse", prompt: "Quelle relation prévoyez-vous observer?", type: "textarea", required: true, criterionId: "method", placeholder: "Formulez une hypothèse vérifiable…" },
        { id: "materials", label: "Matériel critique", prompt: "Quels éléments sont essentiels à la réalisation?", type: "textarea", required: true, criterionId: "method", placeholder: "Listez le matériel et son rôle…" },
      ],
    },
    {
      id: "observations",
      title: "2. Observations",
      description: "Consignez ce que vous avez réellement observé, sans l’interpréter trop tôt.",
      fields: [
        { id: "observations", label: "Observations", prompt: "Décrivez les changements observés pendant le dosage.", type: "textarea", required: true, criterionId: "observations", placeholder: "Couleur, température, point d’équivalence…" },
        { id: "result", label: "Résultat principal", prompt: "Inscrivez votre résultat numérique principal.", type: "number", required: true, criterionId: "observations", placeholder: "Ex. 12,4" },
        { id: "setup", label: "Image du montage ou des résultats", prompt: "Ajoutez une image utile à la compréhension de votre travail.", type: "image", criterionId: "observations" },
      ],
    },
    {
      id: "analysis",
      title: "3. Analyse",
      description: "Reliez vos données à l’hypothèse et identifiez les limites de votre démarche.",
      fields: [
        { id: "analysis", label: "Interprétation", prompt: "Que signifient vos résultats? Appuyez votre réponse sur vos données.", type: "textarea", required: true, criterionId: "analysis", placeholder: "Reliez les données, l’hypothèse et la théorie…" },
        { id: "limits", label: "Limites et amélioration", prompt: "Quelle source d’erreur amélioreriez-vous en priorité?", type: "textarea", required: true, criterionId: "analysis", placeholder: "Expliquez l’impact et l’amélioration proposée…" },
      ],
    },
  ],
};

# Guide de Test - Améliorations UX du Bloc Agent

**Date**: 2025-11-11
**Statut**: ✅ Intégré et prêt à tester

---

## 🎯 Ce qui a été Implémenté

Le bloc Agent du workflow builder utilise maintenant une interface améliorée avec :

### 1. Organisation en Onglets

**4 onglets** pour réduire la surcharge cognitive :

- **📋 Basique** : System prompt, workflow imbriqué
- **🖥️ Modèle** : Provider, modèle, paramètres de génération
- **🔧 Outils** : Web search, file search, computer use, image generation
- **⚙️ Avancé** : Format de réponse, comportements

### 2. Accordéons pour Outils

Chaque outil a maintenant :
- Un toggle pour l'activer/désactiver
- Une section pliable qui s'expand automatiquement quand activé
- Une configuration organisée à l'intérieur

### 3. Composants UI Améliorés

- **Champs standardisés** avec hints, warnings, et erreurs
- **Aide inline expansible** avec exemples copiables
- **Validation visuelle** claire
- **Design responsive** optimisé mobile

---

## 🚀 Comment Tester

### Démarrer l'Application

```bash
cd /home/user/test-chatkit/frontend
npm run dev
```

Ouvrez votre navigateur à l'URL affichée (généralement `http://localhost:5173`)

### Étape 1 : Créer ou Ouvrir un Workflow

1. Naviguez vers le Workflow Builder
2. Créez un nouveau workflow ou ouvrez-en un existant
3. Ajoutez un nœud **Agent** au canvas (glissez depuis la bibliothèque de blocs)

### Étape 2 : Explorer l'Interface à Onglets

**Onglet Basique :**
- [ ] Vérifiez que le champ "System Prompt" s'affiche
- [ ] Cliquez sur "Comment écrire un bon system prompt ?" pour voir l'aide inline
- [ ] Testez la copie des exemples avec le bouton copier
- [ ] Entrez un prompt test

**Onglet Modèle :**
- [ ] Sélectionnez un provider (Anthropic, OpenAI, etc.)
- [ ] Sélectionnez un modèle
- [ ] Ajustez la température (0-1)
- [ ] Ajustez max tokens
- [ ] Vérifiez l'aide inline "Quel modèle choisir ?"

**Onglet Outils :**
- [ ] Activez "Web Search" avec le toggle
- [ ] Vérifiez que la section s'expand automatiquement
- [ ] Configurez le nombre max de résultats
- [ ] Désactivez Web Search → la section doit se fermer
- [ ] Répétez pour File Search, Computer Use, Image Generation

**Onglet Avancé :**
- [ ] Changez le format de réponse (Text/JSON Schema/Widget)
- [ ] Testez les toggles de comportement
- [ ] Vérifiez l'aide inline sur les paramètres avancés

### Étape 3 : Tester la Validation

1. **Champs Requis :**
   - Laissez le system prompt vide
   - Vérifiez qu'un astérisque (*) apparaît sur le label

2. **Erreurs de Configuration :**
   - Activez File Search sans vector store
   - Vérifiez que le message d'erreur s'affiche en rouge

3. **Hints Contextuels :**
   - Survolez ou lisez les hints gris sous les champs
   - Vérifiez qu'ils sont informatifs

### Étape 4 : Tester la Navigation

1. **Navigation Onglets :**
   - [ ] Cliquez sur chaque onglet
   - [ ] Vérifiez l'animation de transition
   - [ ] L'onglet actif doit être souligné en bleu

2. **Keyboard Navigation :**
   - [ ] Utilisez Tab pour naviguer entre les champs
   - [ ] Utilisez Entrée pour activer les toggles
   - [ ] Utilisez flèches pour naviguer les onglets

### Étape 5 : Tester sur Mobile (Responsive)

1. Ouvrez les DevTools (F12)
2. Passez en mode responsive (Ctrl+Shift+M)
3. Sélectionnez un appareil mobile (iPhone, Android)

**Vérifications Mobile :**
- [ ] Les onglets restent accessibles
- [ ] Les icônes d'onglets disparaissent sur petit écran
- [ ] Le texte est lisible
- [ ] Les accordéons fonctionnent bien au toucher
- [ ] L'aide inline s'expand correctement

### Étape 6 : Tester la Sauvegarde

1. Configurez un agent complet
2. Sauvegardez le workflow
3. Rechargez la page
4. Vérifiez que toute la configuration est restaurée
5. Vérifiez que le bon onglet peut être ouvert

---

## 🐛 Problèmes Connus / Limitations

### Champs Non Implémentés (TODO)

Les champs suivants existent dans la V2 mais ne sont pas encore complètement implémentés :

**Onglet Basique :**
- Configuration complète du nested workflow (custom/local/hosted)
  - Actuellement : seulement le system prompt
  - À faire : ajouter radio buttons et selects pour nested workflow

**Onglet Modèle :**
- Paramètres de reasoning (effort, summary, verbosity)
  - Actuellement : affiche juste un badge si le modèle supporte reasoning
  - À faire : ajouter les champs de configuration

**Onglet Outils :**
- Configuration avancée des outils :
  - Web Search : champs de localisation, contexte size
  - File Search : affichage des erreurs de vector store
  - Computer Use : validation des dimensions
  - Image Generation : tous les paramètres (quality, background, etc.)
- MCP Servers configuration
- Weather tool toggle
- Widget validation tool
- Workflow validation tool

**Onglet Avancé :**
- Éditeur JSON Schema (quand format = json_schema)
- Configuration Widget complète (quand format = widget)
  - Source (library vs variable)
  - Widget slug selection
  - Variable bindings

### Comment Compléter ces Champs

Si vous voulez compléter un champ manquant :

1. **Référence** : Consultez `AgentInspectorSection.tsx` (original) lignes 730-1878
2. **Structure** : Ajoutez le JSX dans la bonne Tab dans `AgentInspectorSectionV2.tsx`
3. **Composants** : Utilisez `<Field>`, `<InlineHelp>`, `<AccordionSection>` des ui-components
4. **Styling** : Réutilisez les classes CSS existantes de `NodeInspector.module.css`

---

## ✅ Critères de Réussite

L'implémentation est considérée réussie si :

### Fonctionnel

- [ ] Tous les onglets s'affichent et sont cliquables
- [ ] Les accordéons s'ouvrent/ferment correctement
- [ ] Les toggles activent/désactivent les outils
- [ ] La configuration est sauvegardée et restaurée
- [ ] Aucune erreur console JavaScript
- [ ] Aucune erreur TypeScript

### UX

- [ ] L'interface est plus claire que l'ancienne version
- [ ] La navigation est intuitive
- [ ] L'aide inline est utile
- [ ] Les exemples sont pertinents et copiables
- [ ] Les erreurs sont compréhensibles
- [ ] L'interface mobile est utilisable

### Performance

- [ ] Pas de lag lors du changement d'onglet
- [ ] Pas de re-renders excessifs
- [ ] Les accordéons s'animent fluidement

---

## 📊 Retour d'Expérience

Après vos tests, notez :

### Points Forts

- Qu'est-ce qui fonctionne bien ?
- Quelles améliorations sont les plus utiles ?
- Quel onglet/fonctionnalité préférez-vous ?

### Points à Améliorer

- Qu'est-ce qui ne fonctionne pas comme attendu ?
- Qu'est-ce qui manque ?
- Qu'est-ce qui pourrait être mieux organisé ?

### Bugs Trouvés

- Description du bug
- Étapes pour reproduire
- Comportement attendu vs réel
- Navigateur / OS / taille d'écran

---

## 🔄 Rollback si Nécessaire

Si l'interface V2 pose des problèmes bloquants :

```bash
cd /home/user/test-chatkit/frontend
```

Éditez `src/features/workflow-builder/components/node-inspector/NodeInspector.tsx` :

```diff
- import { AgentInspectorSectionV2 as AgentInspectorSection } from "./sections/AgentInspectorSectionV2";
+ import { AgentInspectorSection } from "./sections/AgentInspectorSection";
```

Puis :

```bash
git add src/features/workflow-builder/components/node-inspector/NodeInspector.tsx
git commit -m "Rollback to AgentInspectorSection V1"
git push
```

---

## 📞 Support

Questions ou problèmes ? Consultez :

- **Documentation** : `/docs/agent-block-ux-improvements-implementation.md`
- **Composants UI** : `/frontend/src/features/workflow-builder/components/node-inspector/ui-components/README.md`
- **Code source** : `AgentInspectorSectionV2.tsx`

---

## 🎯 Prochaines Étapes

Après validation :

1. **Compléter les champs manquants** (nested workflow, reasoning, MCP, etc.)
2. **Intégrer le PresetSelector** lors de la création d'un nœud
3. **Ajouter des tests E2E** pour l'interface
4. **Appliquer les patterns** aux autres types de nœuds (voice_agent, etc.)
5. **Collecter métriques** : temps de configuration, taux d'erreur, satisfaction

---

**Bon test ! 🚀**

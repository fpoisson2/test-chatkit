export type Language = "en" | "fr";

export type TranslationValue = string;

export type TranslationDictionary = Record<string, TranslationValue>;

export type Translations = Record<Language, TranslationDictionary>;

export const AVAILABLE_LANGUAGES: { code: Language; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
];

const fr: TranslationDictionary = {
  "language.name.en": "Anglais",
  "language.name.fr": "Français",
  "language.switcher.label": "Changer de langue",
  "app.sidebar.applications.chat": "Chat",
  "app.sidebar.applications.workflows": "Builder",
  "app.sidebar.applications.vectorStores": "Vector stores",
  "app.sidebar.applications.widgets": "Bibliothèque de widgets",
  "app.sidebar.applications.admin": "Administration",
  "app.sidebar.brandTitle": "ChatKit",
  "app.sidebar.docs": "Documentation",
  "app.sidebar.login": "Connexion",
  "app.sidebar.ariaLabel": "Navigation principale",
  "app.sidebar.switcherLabel": "Applications",
  "app.sidebar.close": "Fermer la barre latérale",
  "app.sidebar.menu": "Menu principal",
  "app.sidebar.profile.role.admin": "Administrateur",
  "app.sidebar.profile.role.user": "Utilisateur",
  "app.sidebar.profile.admin": "Administration",
  "app.sidebar.profile.settings": "Paramètres",
  "app.sidebar.profile.logout": "Déconnexion",
  "admin.tabs.users": "Gestion des utilisateurs",
  "admin.tabs.models": "Modèles disponibles",
  "admin.tabs.vectorStores": "Vector stores",
  "admin.tabs.widgets": "Bibliothèque de widgets",
  "admin.tabs.telephony": "Téléphonie",
  "admin.tabs.settings": "Paramètres généraux",
  "admin.tabs.sectionTitle": "Administration",
  "admin.tabs.navigationLabel": "Navigation du panneau d'administration",
  "admin.models.form.modelIdLabel": "Identifiant du modèle*",
  "admin.models.form.modelIdPlaceholder": "Ex. gpt-4.1-mini",
  "admin.models.form.providerIdLabel": "Identifiant du fournisseur (optionnel)",
  "admin.models.form.providerIdPlaceholder": "Ex. proxy-openai",
  "admin.models.form.providerSlugLabel": "Slug du fournisseur (optionnel)",
  "admin.models.form.providerSlugPlaceholder": "Ex. openai",
  "admin.models.form.providerSelectLabel": "Fournisseur configuré",
  "admin.models.form.providerSelectPlaceholder": "Sélectionnez un fournisseur",
  "admin.models.form.providerSelectLoading": "Chargement des fournisseurs…",
  "admin.models.form.providerSelectHint":
    "Choisissez un fournisseur déjà configuré ou l'API OpenAI native.",
  "admin.models.form.providerOptionOpenAI": "OpenAI (natif)",
  "admin.models.form.providerOptionWithDefault": "{{provider}} (par défaut)",
  "admin.models.form.createTitle": "Ajouter un modèle",
  "admin.models.form.createSubtitle":
    "Déclarez un modèle accessible dans le workflow builder et précisez ses capacités.",
  "admin.models.form.editTitle": "Modifier un modèle",
  "admin.models.form.editSubtitle":
    "Mettez à jour un modèle existant sans recréer son entrée.",
  "admin.models.form.editingNotice":
    "Vous modifiez « {{model}} ». Les changements seront appliqués immédiatement.",
  "admin.models.form.submitCreate": "Ajouter le modèle",
  "admin.models.form.submitUpdate": "Enregistrer les modifications",
  "admin.models.form.cancelEdit": "Annuler la modification",
  "admin.models.form.supportsPreviousResponseId":
    "Réponses incrémentales (previous_response_id) prises en charge",
  "admin.models.form.supportsReasoningSummary":
    "Résumé de raisonnement (reasoning_summary) pris en charge",
  "admin.models.form.storeLabel": "Stockage des réponses",
  "admin.models.form.storeHint":
    "Certains proxys exigent de désactiver le stockage automatique des réponses (store=false).",
  "admin.models.form.storeOptionDisabled": "Désactiver le stockage (false)",
  "admin.models.form.storeOptionDefault":
    "Suivre le comportement par défaut du fournisseur (null)",
  "admin.models.errors.missingModelId": "Indiquez l'identifiant du modèle.",
  "admin.models.errors.missingProvider": "Sélectionnez un fournisseur pour ce modèle.",
  "admin.models.errors.providersLoadFailed":
    "Impossible de charger la liste des fournisseurs disponibles.",
  "admin.models.errors.createFailed": "Impossible d'ajouter le modèle.",
  "admin.models.errors.updateFailed": "Impossible de mettre à jour le modèle.",
  "admin.models.feedback.created":
    "Modèle « {{model}} » ajouté avec succès.",
  "admin.models.feedback.updated":
    "Modèle « {{model}} » mis à jour avec succès.",
  "admin.models.feedback.deleted": "Modèle « {{model}} » supprimé.",
  "admin.models.table.previousResponseId": "Réponses incrémentales",
  "admin.models.table.reasoningSummary": "Résumé de raisonnement",
  "admin.models.table.editAction": "Modifier",
  "admin.models.table.deleteAction": "Supprimer",
  "admin.appSettings.page.title": "Paramètres généraux",
  "admin.appSettings.page.subtitle":
    "Contrôlez le comportement global de ChatKit.",
  "admin.appSettings.threadTitle.cardTitle": "Prompt des titres automatiques",
  "admin.appSettings.threadTitle.cardDescription":
    "Personnalisez le prompt utilisé pour nommer automatiquement les fils de discussion.",
  "admin.appSettings.threadTitle.fieldLabel": "Prompt pour les titres de fils",
  "admin.appSettings.threadTitle.placeholder":
    "Décrivez les instructions pour générer un titre de fil…",
  "admin.appSettings.threadTitle.hint":
    "Le prompt doit contenir des instructions claires en français.",
  "admin.appSettings.threadTitle.status.custom":
    "Un prompt personnalisé est actuellement appliqué.",
  "admin.appSettings.threadTitle.status.default":
    "Le prompt par défaut est utilisé.",
  "admin.appSettings.threadTitle.defaultLabel": "Prompt par défaut",
  "admin.appSettings.threadTitle.modelLabel":
    "Modèle pour les titres de fils",
  "admin.appSettings.threadTitle.modelPlaceholder":
    "Sélectionnez un modèle",
  "admin.appSettings.threadTitle.modelHint":
    "Choisissez un modèle dans la liste ou sélectionnez l'option personnalisée pour saisir un identifiant.",
  "admin.appSettings.threadTitle.modelStatus.custom":
    "Un modèle personnalisé est actuellement appliqué.",
  "admin.appSettings.threadTitle.modelStatus.default":
    "Le modèle par défaut est utilisé.",
  "admin.appSettings.threadTitle.modelDefaultLabel": "Modèle par défaut",
  "admin.appSettings.threadTitle.modelLoadingOption":
    "Chargement des modèles…",
  "admin.appSettings.threadTitle.modelCustomOption": "Autre modèle…",
  "admin.appSettings.threadTitle.modelCustomLabel":
    "Identifiant du modèle personnalisé",
  "admin.appSettings.model.cardTitle": "Fournisseur de modèles",
  "admin.appSettings.model.cardDescription":
    "Configurez le fournisseur utilisé pour exécuter les agents ChatKit.",
  "admin.appSettings.model.enableCustomLabel":
    "Remplacer la configuration d'environnement",
  "admin.appSettings.model.customConfigHint":
    "Définissez un ou plusieurs fournisseurs, leurs URL et leurs clés pour utiliser un proxy personnalisé.",
  "admin.appSettings.model.environmentSummary":
    "Configuration actuelle : fournisseur {{provider}}, base {{base}}.",
  "admin.appSettings.model.providerUnknown": "inconnu",
  "admin.appSettings.model.baseUnknown": "non définie",
  "admin.appSettings.model.providerLabel": "Fournisseur de modèles",
  "admin.appSettings.model.providerOpenAI": "OpenAI (API publique)",
  "admin.appSettings.model.providerLiteLLM":
    "LiteLLM (proxy compatible OpenAI)",
  "admin.appSettings.model.providerCustom": "Autre fournisseur…",
  "admin.appSettings.model.providerNameLabel": "Identifiant du fournisseur",
  "admin.appSettings.model.providerNamePlaceholder": "ex. gemini, claude, litellm",
  "admin.appSettings.model.defaultProviderLabel":
    "Définir comme fournisseur par défaut",
  "admin.appSettings.model.removeProvider": "Supprimer ce fournisseur",
  "admin.appSettings.model.addProvider": "Ajouter un fournisseur",
  "admin.appSettings.model.apiBaseLabel": "URL de base de l'API",
  "admin.appSettings.model.apiBaseHint":
    "L'URL doit commencer par http:// ou https:// et pointer vers le proxy à utiliser.",
  "admin.appSettings.model.apiKeyLabel": "Clé API",
  "admin.appSettings.model.apiKeyPlaceholder":
    "Saisissez une nouvelle clé pour la stocker côté serveur",
  "admin.appSettings.model.apiKeyHelp":
    "Laissez vide pour conserver la clé actuelle ou utiliser la variable d'environnement.",
  "admin.appSettings.model.apiKeyStoredHint":
    "Une clé est enregistrée ({{hint}}). Saisissez une nouvelle clé pour la remplacer.",
  "admin.appSettings.model.apiKeyUnknownHint": "clé masquée",
  "admin.appSettings.model.apiKeyClearLabel": "Supprimer la clé enregistrée",
  "admin.appSettings.success.saved": "Paramètres enregistrés avec succès.",
  "admin.appSettings.success.reset":
    "Le prompt et le modèle par défaut sont rétablis.",
  "admin.appSettings.errors.loadFailed":
    "Impossible de charger les paramètres généraux.",
  "admin.appSettings.errors.saveFailed":
    "Impossible d'enregistrer le prompt personnalisé.",
  "admin.appSettings.errors.resetFailed":
    "Impossible de réinitialiser le prompt.",
  "admin.appSettings.errors.promptRequired":
    "Le prompt doit contenir au moins un caractère.",
  "admin.appSettings.errors.threadTitleModelRequired":
    "Indiquez le modèle à utiliser pour les titres automatiques.",
  "admin.appSettings.errors.threadTitleModelsLoadFailed":
    "Impossible de charger la liste des modèles disponibles.",
  "admin.appSettings.errors.invalidSipPort":
    "Le port SIP doit être un entier compris entre 1 et 65535.",
  "admin.appSettings.errors.invalidSipTransport":
    "Le transport SIP doit être vide ou parmi udp, tcp, tls.",
  "admin.appSettings.errors.sessionExpired":
    "Session expirée, veuillez vous reconnecter.",
  "admin.appSettings.errors.modelProviderRequired":
    "Indiquez l'identifiant du fournisseur lorsque la configuration personnalisée est activée.",
  "admin.appSettings.errors.modelApiBaseRequired":
    "Indiquez l'URL de base de l'API lorsque la configuration personnalisée est activée.",
  "admin.appSettings.errors.modelProvidersRequired":
    "Ajoutez au moins un fournisseur lorsque la configuration personnalisée est activée.",
  "admin.appSettings.errors.modelDefaultRequired":
    "Sélectionnez un fournisseur par défaut.",
  "admin.appSettings.errors.invalidModelApiBase":
    "L'URL de base du fournisseur doit être valide et utiliser http ou https.",
  "admin.appSettings.actions.save": "Enregistrer les paramètres",
  "admin.appSettings.actions.reset": "Revenir aux valeurs par défaut",
  "admin.appSettings.sipTrunk.cardTitle": "Trunk SIP",
  "admin.appSettings.sipTrunk.cardDescription":
    "Configurez l'accès SIP utilisé pour la téléphonie entrante.",
  "admin.appSettings.sipTrunk.uriLabel": "URI du trunk SIP",
  "admin.appSettings.sipTrunk.uriPlaceholder": "ex. sip:pbx.exemple.com",
  "admin.appSettings.sipTrunk.usernameLabel": "Identifiant SIP",
  "admin.appSettings.sipTrunk.usernamePlaceholder": "Identifiant optionnel",
  "admin.appSettings.sipTrunk.passwordLabel": "Mot de passe SIP",
  "admin.appSettings.sipTrunk.passwordPlaceholder": "Mot de passe (optionnel)",
  "admin.appSettings.sipTrunk.passwordHelp":
    "Laissez vide pour désactiver l'authentification par mot de passe.",
  "admin.appSettings.sipTrunk.contactHostLabel":
    "Hôte Contact SIP",
  "admin.appSettings.sipTrunk.contactHostPlaceholder":
    "ex. 192.0.2.10",
  "admin.appSettings.sipTrunk.contactHostHelp":
    "Laissez vide pour que ChatKit détecte automatiquement l'adresse IP sortante.",
  "admin.appSettings.sipTrunk.contactPortLabel": "Port Contact SIP",
  "admin.appSettings.sipTrunk.contactPortPlaceholder": "ex. 5070",
  "admin.appSettings.sipTrunk.contactTransportLabel":
    "Transport Contact SIP",
  "admin.appSettings.sipTrunk.contactTransportOptionDefault":
    "Utiliser la valeur par défaut",
  "admin.appSettings.sipTrunk.contactTransportOptionUdp": "UDP",
  "admin.appSettings.sipTrunk.contactTransportOptionTcp": "TCP",
  "admin.appSettings.sipTrunk.contactTransportOptionTls": "TLS",
  "admin.appSettings.sipTrunk.contactTransportHelp":
    "Sélectionnez le transport annoncé dans l'en-tête Contact (laisser vide pour la valeur par défaut).",
  "auth.login.title": "Connexion",
  "auth.login.subtitle":
    "Accédez au panneau d'administration pour gérer les utilisateurs et vos sessions ChatKit.",
  "auth.login.email.label": "Adresse e-mail",
  "auth.login.email.placeholder": "vous@example.com",
  "auth.login.password.label": "Mot de passe",
  "auth.login.password.placeholder": "••••••••",
  "auth.login.submit.loading": "Connexion en cours…",
  "auth.login.submit.label": "Se connecter",
  "auth.login.error.failure": "Échec de la connexion",
  "auth.login.error.unexpected": "Une erreur inattendue est survenue",
  "auth.login.error.unreachable": "Impossible de joindre le backend d'authentification",
  "layout.menu.openSidebar": "Ouvrir la navigation générale",
  "settings.page.title": "Paramètres",
  "settings.page.subtitle":
    "Personnalisez votre expérience d'utilisation de ChatKit.",
  "settings.page.navLabel": "Navigation des paramètres",
  "settings.sections.preferences.label": "Préférences",
  "settings.sections.preferences.description":
    "Personnalisez votre expérience d'utilisation de ChatKit.",
  "docs.title": "Documentation",
  "docs.subtitle": "Consultez les guides internes et les fiches de référence.",
  "docs.list.loading": "Chargement de la documentation…",
  "docs.list.error": "Impossible de charger la documentation.",
  "docs.list.empty": "Aucun document n'est disponible pour le moment.",
  "docs.list.create": "Nouveau document",
  "docs.list.language": "Langue : {{language}}",
  "docs.list.updatedAt": "Mis à jour le {{value}}",
  "docs.list.open": "Ouvrir",
  "docs.errors.sessionExpired": "Session expirée, veuillez vous reconnecter.",
  "docs.editor.title.create": "Créer un document",
  "docs.editor.title.edit": "Modifier le document",
  "docs.editor.fields.slug": "Identifiant (slug)",
  "docs.editor.fields.title": "Titre",
  "docs.editor.fields.summary": "Résumé",
  "docs.editor.fields.content": "Contenu Markdown",
  "docs.editor.actions.cancel": "Annuler",
  "docs.editor.actions.create": "Créer",
  "docs.editor.actions.save": "Enregistrer",
  "docs.editor.saving": "Enregistrement…",
  "docs.editor.creating": "Création…",
  "docs.editor.error.requiredSlug": "L'identifiant est requis.",
  "docs.editor.error.unexpected": "Une erreur inattendue est survenue.",
  "docs.detail.loading": "Chargement du document…",
  "docs.detail.error": "Impossible de charger ce document.",
  "docs.detail.missing": "Document introuvable.",
  "docs.detail.back": "← Retour aux documents",
  "docs.detail.edit": "Modifier",
  "docs.detail.delete": "Supprimer",
  "docs.detail.delete.confirm": "Supprimer le document « {{title}} » ?",
  "docs.detail.updatedAt": "Mis à jour le {{value}}",
  "docs.detail.language": "Langue : {{language}}",
  "docs.detail.empty": "Ce document ne contient pas encore de contenu.",
  "docs.detail.fallbackTitle": "Document",
  "settings.modal.title": "Paramètres rapides",
  "settings.modal.subtitle": "Accédez rapidement aux sections clés de votre espace.",
  "settings.modal.close": "Fermer les paramètres",
  "settings.modal.navLabel": "Sections des paramètres",
  "settings.preferences.language.title": "Langue de l'interface",
  "settings.preferences.language.description":
    "Choisissez la langue affichée pour l'application et ses menus.",
  "settings.preferences.language.label": "Langue préférée",
  "settings.preferences.language.hint":
    "ChatKit détecte automatiquement la langue de votre navigateur lors de votre première connexion.",
  "Propriétés de l'arête sélectionnée": "Propriétés de l'arête sélectionnée",
  "Connexion sélectionnée": "Connexion sélectionnée",
  "Supprimer cette connexion": "Supprimer cette connexion",
  "Depuis": "Depuis",
  "Vers": "Vers",
  "Branche conditionnelle": "Branche conditionnelle",
  "Laisser vide pour la branche par défaut": "Laisser vide pour la branche par défaut",
  "Attribuez un nom unique (ex. approuve, rejeté). Laissez vide pour définir la branche par défaut.":
    "Attribuez un nom unique (ex. approuve, rejeté). Laissez vide pour définir la branche par défaut.",
  "Libellé affiché": "Libellé affiché",
  "workflowBuilder.actions.importJson": "Importer un JSON",
  "workflowBuilder.agentInspector.modelLabel": "Modèle disponible",
  "workflowBuilder.agentInspector.modelHelp": "Choisissez un modèle disponible pour exécuter ce bloc.",
  "workflowBuilder.agentInspector.modelPlaceholder": "Sélectionnez un modèle",
  "workflowBuilder.agentInspector.reasoningSuffix": " – raisonnement",
  "workflowBuilder.agentInspector.providerLabel": "Fournisseur",
  "workflowBuilder.agentInspector.providerPlaceholder": "Tous les fournisseurs",
  "workflowBuilder.agentInspector.nestedWorkflowLabel": "Workflow imbriqué",
  "workflowBuilder.agentInspector.nestedWorkflowHelp":
    "Sélectionnez un workflow existant à exécuter à la place de cet agent.",
  "workflowBuilder.agentInspector.nestedWorkflowNoneOption": "Sélectionnez un workflow",
  "workflowBuilder.agentInspector.nestedWorkflowCustomOption": "Personnalisé",
  "workflowBuilder.agentInspector.nestedWorkflowLocalOption": "Workflow local",
  "workflowBuilder.agentInspector.nestedWorkflowHostedOption": "Workflow hébergé",
  "workflowBuilder.agentInspector.nestedWorkflowHostedSelectLabel": "Workflow hébergé",
  "workflowBuilder.agentInspector.nestedWorkflowHostedLoading": "Chargement des workflows…",
  "workflowBuilder.agentInspector.nestedWorkflowHostedSelectEmpty": "Aucun workflow hébergé disponible",
  "workflowBuilder.agentInspector.nestedWorkflowHostedIdLabel": "Identifiant du workflow",
  "workflowBuilder.agentInspector.nestedWorkflowHostedIdPlaceholder": "Ex. 123",
  "workflowBuilder.agentInspector.nestedWorkflowMissing":
    "Le workflow sélectionné n'est plus disponible.",
  "workflowBuilder.agentInspector.nestedWorkflowSlugInfo":
    "Workflow sélectionné via le slug « {{slug}} ».",
  "workflowBuilder.agentInspector.nestedWorkflowSelectedInfo":
    "Les autres paramètres sont masqués car ce bloc délègue au workflow imbriqué «{{label}}».",
  "workflowBuilder.agentInspector.nestedWorkflowSelectedInfoUnknown":
    "Les autres paramètres sont masqués car ce bloc délègue à un workflow imbriqué.",
  "workflowBuilder.agentInspector.unlistedModelWarning":
    "Ce bloc utilise actuellement un modèle non listé ({{model}}). Sélectionnez un modèle dans la liste ci-dessus.",
  "workflowBuilder.agentInspector.workflowToolsTitle": "Workflows ChatKit",
  "workflowBuilder.agentInspector.workflowToolsDescription":
    "Expose ces workflows comme des tools que l'agent peut appeler via des function calls.",
  "workflowBuilder.agentInspector.workflowToolsToggleHelp":
    "Ajoute le workflow « {{slug}} » comme outil appelable.",
  "workflowBuilder.agentInspector.workflowToolsEmpty":
    "Aucun autre workflow disponible pour être ajouté comme outil.",
  "workflowBuilder.agentInspector.workflowToolsMissing":
    "Le workflow « {{slug}} » n'est plus disponible. Retirez-le de la configuration.",
  "workflowBuilder.agentInspector.mcpSectionTitle": "Serveur MCP",
  "workflowBuilder.agentInspector.mcpSectionDescription":
    "Connectez un serveur MCP existant pour exposer ses outils à l'agent.",
  "workflowBuilder.agentInspector.mcpEnabledLabel": "Activer le serveur MCP",
  "workflowBuilder.agentInspector.mcpEnabledHelp":
    "Désactivez ce commutateur pour retirer temporairement l'intégration MCP de l'agent.",
  "workflowBuilder.agentInspector.mcpDisabledInfo":
    "Activez le serveur MCP pour configurer l'URL et tester la connexion.",
  "workflowBuilder.agentInspector.mcpUrlLabel": "URL du serveur MCP",
  "workflowBuilder.agentInspector.mcpAuthorizationLabel":
    "Clé d'autorisation (Bearer …)",
  "workflowBuilder.agentInspector.mcpAuthorizationPlaceholder": "Bearer …",
  "workflowBuilder.agentInspector.mcpAuthorizationHelp":
    "Laissez vide si le serveur n'exige pas d'authentification.",
  "workflowBuilder.agentInspector.mcpClientIdLabel": "Identifiant client (optionnel)",
  "workflowBuilder.agentInspector.mcpClientIdPlaceholder": "Client ID OAuth2",
  "workflowBuilder.agentInspector.mcpScopeLabel": "Scopes OAuth (optionnel)",
  "workflowBuilder.agentInspector.mcpScopePlaceholder": "ex. profile email",
  "workflowBuilder.agentInspector.mcpScopeHelp":
    "Séparez les scopes par des espaces. Laissez vide pour utiliser la configuration par défaut du fournisseur.",
  "workflowBuilder.agentInspector.mcpOAuthButton": "Se connecter via OAuth",
  "workflowBuilder.agentInspector.mcpOAuthStatus.starting":
    "Initialisation du flux OAuth…",
  "workflowBuilder.agentInspector.mcpOAuthStatus.pending":
    "Autorisez la connexion dans la fenêtre ouverte, puis revenez ici.",
  "workflowBuilder.agentInspector.mcpOAuthStatus.success":
    "Jeton OAuth enregistré avec succès.",
  "workflowBuilder.agentInspector.mcpOAuthStatus.error":
    "Échec de l'authentification OAuth.",
  "workflowBuilder.agentInspector.mcpOAuthStatus.errorWithDetail":
    "Échec de l'authentification OAuth : {{detail}}",
  "workflowBuilder.agentInspector.mcpOAuthStatus.windowBlocked":
    "Impossible d'ouvrir la fenêtre d'autorisation. Autorisez les fenêtres pop-up et réessayez.",
  "workflowBuilder.agentInspector.mcpOAuthStatus.sessionExpired":
    "La session OAuth a expiré. Relancez l'authentification.",
  "workflowBuilder.agentInspector.mcpOAuthStatus.noAccessToken":
    "Le fournisseur OAuth n'a pas renvoyé de jeton d'accès.",
  "workflowBuilder.agentInspector.mcpOAuthStatus.unknownError": "erreur inconnue",
  "workflowBuilder.agentInspector.mcpTestButton": "Tester la connexion",
  "workflowBuilder.agentInspector.mcpTestStatus.ok":
    "Connexion établie. {{count}} outil(s) disponible(s).",
  "workflowBuilder.agentInspector.mcpTestStatus.unauthorized":
    "Authentification refusée par le serveur MCP.",
  "workflowBuilder.agentInspector.mcpTestStatus.forbidden":
    "Accès refusé par le serveur MCP.",
  "workflowBuilder.agentInspector.mcpTestStatus.http_error":
    "Le serveur MCP a renvoyé le statut HTTP {{statusCode}}.",
  "workflowBuilder.agentInspector.mcpTestStatus.timeout":
    "Le serveur MCP n'a pas répondu avant l'expiration du délai.",
  "workflowBuilder.agentInspector.mcpTestStatus.error":
    "Test de connexion impossible : {{detail}}",
  "workflowBuilder.agentInspector.mcpTestStatus.invalidConfig":
    "Renseignez une URL MCP valide avant de lancer le test.",
  "workflowBuilder.agentInspector.mcpTestStatus.loading": "Test de connexion en cours…",
  "workflowBuilder.agentInspector.mcpTestStatus.toolListLabel": "Outils disponibles",
  "workflowBuilder.agentInspector.mcpTestStatus.errorUnknown": "erreur inconnue",
  "workflowBuilder.agentInspector.modelsLoading": "Chargement des modèles disponibles…",
  "workflowBuilder.agentInspector.imageToolToggleHelp":
    "Ajoute l'outil image_generation pour produire des visuels. Actuellement, seule l'API Images d'OpenAI est prise en charge.",
  "workflowBuilder.agentInspector.imageModelHelp":
    "Sélectionnez un modèle d'image pris en charge. Actuellement, seules les variantes OpenAI sont disponibles.",
  "workflowBuilder.agentInspector.computerUseToggle": "Activer l'outil computer-use",
  "workflowBuilder.agentInspector.computerUseToggleHelp":
    "Autorise l'agent à contrôler un ordinateur hébergé, en démarrant un navigateur dédié.",
  "workflowBuilder.agentInspector.computerUseWidthLabel": "Largeur de l'écran (px)",
  "workflowBuilder.agentInspector.computerUseHeightLabel": "Hauteur de l'écran (px)",
  "workflowBuilder.agentInspector.computerUseEnvironmentLabel": "Environnement",
  "workflowBuilder.agentInspector.computerUseEnvironment.browser": "Navigateur",
  "workflowBuilder.agentInspector.computerUseEnvironment.mac": "macOS",
  "workflowBuilder.agentInspector.computerUseEnvironment.windows": "Windows",
  "workflowBuilder.agentInspector.computerUseEnvironment.ubuntu": "Ubuntu",
  "workflowBuilder.agentInspector.computerUseStartUrlLabel": "URL initiale (optionnel)",
  "workflowBuilder.agentInspector.computerUseStartUrlHelp":
    "Charge cette URL dès le démarrage de la session contrôlée (laisser vide pour utiliser la page par défaut).",
  "workflowBuilder.agentInspector.computerUseStartUrlPlaceholder": "https://exemple.com",
  "workflowBuilder.startInspector.autoRunLabel": "Démarrer automatiquement",
  "workflowBuilder.startInspector.autoRunHelp":
    "Exécute immédiatement le workflow lors de l'ouverture d'un fil, même sans message utilisateur.",
  "workflowBuilder.startInspector.autoRunUserMessageLabel": "Message utilisateur initial",
  "workflowBuilder.startInspector.autoRunUserMessagePlaceholder":
    "Ex. Bonjour, voici les informations de départ… (facultatif)",
  "workflowBuilder.startInspector.autoRunUserMessageHint":
    "Ce message est transmis à l'agent lorsqu'un fil démarre sans saisie utilisateur. Saisir un message assistant ci-dessous effacera automatiquement ce contenu.",
  "workflowBuilder.startInspector.autoRunAssistantMessageLabel": "Message assistant initial",
  "workflowBuilder.startInspector.autoRunAssistantMessagePlaceholder":
    "Ex. Bonjour, je suis votre assistant… (facultatif)",
  "workflowBuilder.startInspector.autoRunAssistantMessageHint":
    "Ce message est diffusé en tant que première réponse de l'assistant lorsque le démarrage automatique est déclenché. Ajoutez un message utilisateur ci-dessus pour désactiver cette réponse.",
  "workflowBuilder.startInspector.hostedSectionTitle": "Workflows hébergés",
  "workflowBuilder.startInspector.hostedSectionDescription":
    "Exposez des workflows ChatKit hébergés directement depuis ce bloc Start.",
  "workflowBuilder.startInspector.hostedEmpty":
    "Aucun workflow hébergé n'est configuré pour le moment.",
  "workflowBuilder.startInspector.hostedAddButton": "Ajouter un workflow hébergé",
  "workflowBuilder.startInspector.hostedSlugLabel": "Slug du workflow hébergé",
  "workflowBuilder.startInspector.hostedSlugPlaceholder": "ex. support-pro",
  "workflowBuilder.startInspector.hostedSlugHelp":
    "Identifiant lisible utilisé pour distinguer chaque workflow hébergé.",
  "workflowBuilder.startInspector.hostedSlugErrorRequired": "Le slug est obligatoire.",
  "workflowBuilder.startInspector.hostedSlugErrorDuplicate":
    "Chaque slug doit être unique.",
  "workflowBuilder.startInspector.hostedLabelLabel": "Libellé affiché",
  "workflowBuilder.startInspector.hostedLabelPlaceholder":
    "Nom visible dans la barre latérale",
  "workflowBuilder.startInspector.hostedWorkflowIdLabel":
    "Identifiant du workflow hébergé",
  "workflowBuilder.startInspector.hostedWorkflowIdPlaceholder":
    "ID fourni par la console ChatKit",
  "workflowBuilder.startInspector.hostedWorkflowIdHelp":
    "Copiez l'identifiant du workflow publié depuis la console ChatKit.",
  "workflowBuilder.startInspector.hostedWorkflowIdError":
    "Indiquez l'identifiant du workflow hébergé.",
  "workflowBuilder.startInspector.hostedDescriptionLabel": "Description (optionnel)",
  "workflowBuilder.startInspector.hostedDescriptionPlaceholder":
    "Note interne ou aide contextuelle affichée dans l'UI",
  "workflowBuilder.startInspector.hostedRemoveButton":
    "Supprimer ce workflow hébergé",
  "workflowBuilder.startInspector.telephonyIsSipWorkflowLabel": "Workflow pour les appels SIP",
  "workflowBuilder.startInspector.telephonyIsSipWorkflowHelp":
    "Activez cette option pour que ce workflow soit utilisé lors des appels SIP entrants. Un seul workflow peut être configuré comme workflow SIP à la fois. Les paramètres voix seront pris du bloc voice-agent du workflow.",
  "workflowBuilder.startInspector.telephonyRingTimeoutLabel": "Délai de sonnerie (secondes)",
  "workflowBuilder.startInspector.telephonyRingTimeoutHelp":
    "Durée pendant laquelle le téléphone sonnera avant que l'agent vocal ne réponde. Valeur entre 0 et 30 secondes.",
  "workflows.hostedBadge": "Hébergé",
  "workflows.hostedUnavailable": "Indisponible pour le moment.",
  "workflows.hostedCompactLabel": "{label} (hébergé)",
  "workflowBuilder.createWorkflow.modal.title": "Nouveau workflow",
  "workflowBuilder.createWorkflow.modal.typeLabel": "Type",
  "workflowBuilder.createWorkflow.modal.typeLocal": "Local",
  "workflowBuilder.createWorkflow.modal.typeHosted": "Hébergé",
  "workflowBuilder.createWorkflow.modal.nameLabel": "Nom du workflow",
  "workflowBuilder.createWorkflow.modal.remoteIdLabel":
    "ID du workflow hébergé",
  "workflowBuilder.createWorkflow.modal.submit": "Créer",
  "workflowBuilder.createWorkflow.modal.cancel": "Annuler",
  "workflowBuilder.createWorkflow.openModal": "Créer un workflow",
  "workflowBuilder.createWorkflow.errorMissingName":
    "Le nom du workflow est obligatoire.",
  "workflowBuilder.createWorkflow.errorMissingRemoteId":
    "L'identifiant du workflow hébergé est obligatoire.",
  "workflowBuilder.createWorkflow.creatingHosted": "Création du workflow hébergé…",
  "workflowBuilder.createWorkflow.successHosted":
    "Workflow hébergé \"{label}\" ajouté avec succès.",
  "workflowBuilder.createWorkflow.errorCreateHosted":
    "Impossible de créer le workflow hébergé.",
  "workflowBuilder.createWorkflow.errorAuthentication":
    "Vous devez être connecté pour gérer les workflows hébergés.",
  "workflowBuilder.createWorkflow.successLocal":
    "Workflow \"{name}\" créé avec succès.",
  "workflowBuilder.createWorkflow.errorCreateLocal":
    "Impossible de créer le workflow.",
  "workflowBuilder.hostedSection.title": "Workflows hébergés",
  "workflowBuilder.hostedSection.loading": "Chargement des workflows hébergés…",
  "workflowBuilder.hostedSection.empty":
    "Aucun workflow hébergé géré depuis l'interface n'est disponible pour le moment.",
  "workflowBuilder.hostedSection.deleteAction": "Supprimer",
  "workflowBuilder.hostedSection.remoteId": "ID distant : {id}",
  "workflowBuilder.hostedSection.deleting": "Suppression du workflow hébergé…",
  "workflowBuilder.hostedSection.deleteSuccess":
    "Workflow hébergé \"{label}\" supprimé.",
  "workflowBuilder.hostedSection.deleteError":
    "Impossible de supprimer le workflow hébergé.",
  "workflowBuilder.hostedSection.loadError":
    "Impossible de charger les workflows hébergés.",
  "workflowBuilder.hostedSection.confirmDelete":
    "Supprimer le workflow hébergé \"{label}\" ? Cette action est irréversible.",
  "workflowBuilder.save.autoSaveSuccess": "Modifications enregistrées automatiquement.",
  "workflowBuilder.save.draftDisplayName": "Brouillon",
  "workflowBuilder.save.failure": "Impossible d'enregistrer le workflow.",
  "workflowBuilder.save.failureWithStatus": "Échec de l'enregistrement ({{status}}).",
  "workflowBuilder.actions.exportJson": "Exporter en JSON",
  "workflowBuilder.export.preparing": "Préparation de l'export…",
  "workflowBuilder.export.success": "Export JSON téléchargé.",
  "workflowBuilder.export.error": "Impossible d'exporter le workflow.",
  "workflowBuilder.export.errorWithStatus": "Impossible d'exporter le workflow (code {{status}}).",
  "workflowBuilder.mobileActions.open": "Afficher les actions",
  "workflowBuilder.mobileActions.title": "Actions du workflow",
  "workflowBuilder.mobileActions.close": "Fermer",
  "workflowBuilder.mobileActions.properties": "Propriétés du bloc",
  "workflowBuilder.mobileActions.duplicate": "Dupliquer la sélection",
  "workflowBuilder.mobileActions.delete": "Supprimer la sélection",
  "workflowBuilder.deleteBlock.confirm":
    "Supprimer le bloc « {{name}} » ? Cette action est irréversible.",
  "workflowBuilder.deleteSelection.confirmSingle":
    "Supprimer le bloc sélectionné ? Cette action est irréversible.",
  "workflowBuilder.deleteSelection.confirmMultiple":
    "Supprimer les {{count}} blocs sélectionnés ? Cette action est irréversible.",
  "workflowBuilder.mobileActions.undo": "Annuler (Ctrl+Z)",
  "workflowBuilder.mobileActions.redo": "Rétablir (Ctrl+Y)",
  "workflowBuilder.preview.enter": "Activer la prévisualisation",
  "workflowBuilder.preview.exit": "Quitter la prévisualisation",
  "workflowBuilder.preview.title": "Chat de prévisualisation",
  "workflowBuilder.preview.banner": "Mode prévisualisation activé : l'édition du workflow est verrouillée.",
  "workflowBuilder.preview.initializing": "Initialisation de la session…",
  "workflowBuilder.preview.composerPlaceholder": "Envoyez un message pour tester ce workflow…",
  "workflowBuilder.preview.untitled": "Workflow sans titre",
  "workflowBuilder.preview.draftLabel": "Brouillon",
  "workflowBuilder.preview.versionLabel": "Version v{{version}}",
  "workflowBuilder.duplicate.success": "Sélection dupliquée.",
  "workflowBuilder.duplicate.empty": "Sélectionnez un bloc à dupliquer.",
  "workflowBuilder.duplicate.error": "Impossible de dupliquer la sélection.",
  "workflowBuilder.import.inProgress": "Import en cours…",
  "workflowBuilder.import.saving": "Importation du workflow…",
  "workflowBuilder.import.success": "Workflow importé avec succès.",
  "workflowBuilder.import.error": "Impossible d'importer le workflow.",
  "workflowBuilder.import.errorInvalidJson": "Le fichier ne contient pas un JSON valide.",
  "workflowBuilder.import.errorInvalidGraph": "Le JSON ne décrit pas un graphe de workflow valide.",
  "workflowBuilder.import.errorInvalidNode": "Un bloc du workflow est invalide.",
  "workflowBuilder.import.errorInvalidEdge": "Une connexion du workflow est invalide.",
  "workflowBuilder.import.errorMissingNodes": "Le JSON ne contient aucun bloc de workflow.",
  "workflowBuilder.import.errorMissingName": "Le nom du workflow importé est requis.",
  "workflowBuilder.import.errorFileRead": "Impossible de lire le fichier sélectionné.",
  "workflowBuilder.import.promptDisplayName": "Nom du workflow importé ?",
  "workflowBuilder.import.defaultVersionName": "Import du {{timestamp}}",
  "workflowBuilder.import.errorWithStatus": "Impossible d'importer le workflow (code {{status}}).",
  "workflowBuilder.clipboard.copySelectionSuccess": "Sélection copiée dans le presse-papiers.",
  "workflowBuilder.clipboard.copyAllSuccess": "Workflow complet copié dans le presse-papiers.",
  "workflowBuilder.clipboard.copyEmpty": "Aucun bloc sélectionné à copier.",
  "workflowBuilder.clipboard.copyError": "Impossible de copier la sélection.",
  "workflowBuilder.clipboard.pasteEmpty": "Le presse-papiers est vide.",
  "workflowBuilder.clipboard.pasteInvalid": "Le presse-papiers ne contient pas un workflow valide.",
  "workflowBuilder.clipboard.pasteNothing": "Aucun bloc à coller.",
  "workflowBuilder.clipboard.pasteError": "Impossible de coller le workflow.",
  "workflowBuilder.clipboard.pasteSuccess": "Blocs collés depuis le presse-papiers.",
  "workflowBuilder.deploy.missingTarget": "Aucune version sélectionnée à promouvoir.",
  "workflowBuilder.deploy.pendingChangesError": "Enregistrement requis avant le déploiement.",
  "workflowBuilder.deploy.promoting": "Promotion de la version sélectionnée…",
  "workflowBuilder.deploy.successProduction": "Version sélectionnée déployée en production.",
  "workflowBuilder.deploy.successPublished": "Version sélectionnée publiée.",
  "workflowBuilder.deploy.promoteFailedWithStatus": "Échec de la promotion (code {{status}}).",
  "workflowBuilder.deploy.promoteError": "Impossible de promouvoir la version sélectionnée.",
  "workflowBuilder.deploy.publishError": "Impossible de publier le workflow.",
  "workflowBuilder.deploy.modal.titlePublishDraft": "Publier les modifications ?",
  "workflowBuilder.deploy.modal.descriptionPublishDraft":
    "Créez une nouvelle version du workflow avec vos dernières modifications.",
  "vectorStore.ingestion.success.document":
    "Document « {{docId}} » ingéré ({{chunkCount}} segment{{pluralSuffix}}).",
  "workflowBuilder.deploy.modal.titlePromoteSelected": "Déployer la version sélectionnée ?",
  "workflowBuilder.deploy.modal.descriptionPromoteSelected":
    "Remplace la version de production actuelle par la révision v{{version}}.",
  "workflowBuilder.deploy.modal.titleMissing": "Sélectionner une version à déployer",
  "workflowBuilder.deploy.modal.descriptionMissing":
    "Choisissez un brouillon ou une version existante à promouvoir.",
  "workflowBuilder.deploy.modal.path.draft": "Brouillon",
  "workflowBuilder.deploy.modal.path.newVersion": "Nouvelle version",
  "workflowBuilder.deploy.modal.path.selectedWithVersion": "Version sélectionnée v{{version}}",
  "workflowBuilder.deploy.modal.path.production": "Production",
  "workflowBuilder.deploy.modal.productionToggle": "Déployer en production",
  "workflowBuilder.deploy.modal.action.cancel": "Annuler",
  "workflowBuilder.deploy.modal.action.publish": "Publier",
  "workflowBuilder.deploy.modal.action.deploy": "Déployer",
  "workflowBuilder.voiceInspector.modelLabel": "Modèle Realtime",
  "workflowBuilder.voiceInspector.voiceLabel": "Voix",
  "workflowBuilder.voiceInspector.instructionsLabel": "Instructions temps réel",
  "workflowBuilder.voiceInspector.instructionsPlaceholder":
    "Texte transmis à l'assistant vocal pour guider son comportement",
  "workflowBuilder.voiceInspector.startBehaviorLabel": "Démarrage de session",
  "workflowBuilder.voiceInspector.stopBehaviorLabel": "Arrêt de session",
  "workflowBuilder.voiceInspector.start.manual": "Lancement manuel",
  "workflowBuilder.voiceInspector.start.auto": "Démarrage automatique à l'entrée du bloc",
  "workflowBuilder.voiceInspector.stop.manual": "Arrêt manuel (session persistante)",
  "workflowBuilder.voiceInspector.stop.auto": "Arrêt automatique après la réponse",
  "workflowBuilder.voiceInspector.toolsLabel": "Outils temps réel",
  "workflowBuilder.voiceInspector.tool.response": "Réponses audio",
  "workflowBuilder.voiceInspector.tool.transcription": "Transcriptions",
  "workflowBuilder.voiceInspector.tool.functionCall": "Fonctions personnalisées",
  "workflowBuilder.voiceInspector.tool.functionCall.help":
    "Active les appels de fonction via le runtime Realtime.",
  "workflowBuilder.node.kind.start": "Début",
  "workflowBuilder.node.kind.agent": "Agent",
  "workflowBuilder.node.kind.voice_agent": "Agent vocal",
  "workflowBuilder.node.kind.condition": "Condition",
  "workflowBuilder.node.kind.state": "Bloc état",
  "workflowBuilder.node.kind.transform": "Bloc transform",
  "workflowBuilder.node.kind.watch": "Bloc watch",
  "workflowBuilder.node.kind.wait_for_user_input": "Attente utilisateur",
  "workflowBuilder.node.kind.assistant_message": "Message assistant",
  "workflowBuilder.node.kind.user_message": "Message utilisateur",
  "workflowBuilder.node.kind.json_vector_store": "Stockage JSON",
  "workflowBuilder.node.kind.parallel_split": "Scission parallèle",
  "workflowBuilder.node.kind.parallel_join": "Jointure parallèle",
  "workflowBuilder.node.kind.widget": "Bloc widget",
  "workflowBuilder.node.kind.end": "Fin",
  "workflowBuilder.parallel.joinSlugLabel": "Jointure associée",
  "workflowBuilder.parallel.joinSlugHelp": "Indiquez le slug du bloc parallel_join correspondant.",
  "workflowBuilder.parallel.joinSlugPlaceholder": "Ex. parallel-join-1",
  "workflowBuilder.parallel.branchesTitle": "Branches parallèles",
  "workflowBuilder.parallel.branchLabelLabel": "Libellé de la branche {{index}}",
  "workflowBuilder.parallel.branchLabelPlaceholder": "Nom affiché dans l'interface",
  "workflowBuilder.parallel.branchSlugLabel": "Identifiant interne : {{slug}}",
  "workflowBuilder.parallel.branchRemove": "Supprimer",
  "workflowBuilder.parallel.branchAdd": "Ajouter une branche",
  "workflowBuilder.parallel.branchHint":
    "Créez autant de branches que de connexions sortantes depuis ce bloc.",
  "workflowBuilder.parallel.branchMinimum":
    "Au moins deux branches sont nécessaires pour une scission parallèle.",
};

const en: TranslationDictionary = {
  "language.name.en": "English",
  "language.name.fr": "French",
  "language.switcher.label": "Change language",
  "app.sidebar.applications.chat": "Chat",
  "app.sidebar.applications.workflows": "Builder",
  "app.sidebar.applications.vectorStores": "Vector stores",
  "app.sidebar.applications.widgets": "Widget library",
  "app.sidebar.applications.admin": "Administration",
  "app.sidebar.brandTitle": "ChatKit",
  "app.sidebar.docs": "Docs",
  "app.sidebar.login": "Sign in",
  "app.sidebar.ariaLabel": "Primary navigation",
  "app.sidebar.switcherLabel": "Applications",
  "app.sidebar.close": "Close sidebar",
  "app.sidebar.menu": "Main menu",
  "app.sidebar.profile.role.admin": "Administrator",
  "app.sidebar.profile.role.user": "User",
  "app.sidebar.profile.admin": "Administration",
  "app.sidebar.profile.settings": "Settings",
  "app.sidebar.profile.logout": "Sign out",
  "admin.tabs.users": "User management",
  "admin.tabs.models": "Available models",
  "admin.tabs.vectorStores": "Vector stores",
  "admin.tabs.widgets": "Widget library",
  "admin.tabs.telephony": "Telephony",
  "admin.tabs.settings": "General settings",
  "admin.tabs.sectionTitle": "Administration",
  "admin.tabs.navigationLabel": "Administration navigation",
  "admin.models.form.modelIdLabel": "Model identifier*",
  "admin.models.form.modelIdPlaceholder": "e.g. gpt-4.1-mini",
  "admin.models.form.providerIdLabel": "Provider identifier (optional)",
  "admin.models.form.providerIdPlaceholder": "e.g. proxy-openai",
  "admin.models.form.providerSlugLabel": "Provider slug (optional)",
  "admin.models.form.providerSlugPlaceholder": "e.g. openai",
  "admin.models.form.providerSelectLabel": "Configured provider",
  "admin.models.form.providerSelectPlaceholder": "Select a provider",
  "admin.models.form.providerSelectLoading": "Loading providers…",
  "admin.models.form.providerSelectHint":
    "Pick a provider that is already configured or the native OpenAI API.",
  "admin.models.form.providerOptionOpenAI": "OpenAI (native)",
  "admin.models.form.providerOptionWithDefault": "{{provider}} (default)",
  "admin.models.form.createTitle": "Add a model",
  "admin.models.form.createSubtitle":
    "Register a model available in the workflow builder and specify its capabilities.",
  "admin.models.form.editTitle": "Edit a model",
  "admin.models.form.editSubtitle":
    "Update an existing model without creating a new entry.",
  "admin.models.form.editingNotice":
    "Editing \"{{model}}\". Changes apply immediately.",
  "admin.models.form.submitCreate": "Add model",
  "admin.models.form.submitUpdate": "Save changes",
  "admin.models.form.cancelEdit": "Cancel edit",
  "admin.models.form.supportsPreviousResponseId":
    "Supports incremental responses (previous_response_id)",
  "admin.models.form.supportsReasoningSummary":
    "Supports reasoning summary (reasoning_summary)",
  "admin.models.form.storeLabel": "Response storage",
  "admin.models.form.storeHint":
    "Some proxies require disabling automatic response storage (store=false).",
  "admin.models.form.storeOptionDisabled": "Disable storage (false)",
  "admin.models.form.storeOptionDefault":
    "Use the provider default behaviour (null)",
  "admin.models.errors.missingModelId": "Enter the model identifier.",
  "admin.models.errors.missingProvider": "Select a provider for this model.",
  "admin.models.errors.providersLoadFailed":
    "Unable to load the list of available providers.",
  "admin.models.errors.createFailed": "Unable to add the model.",
  "admin.models.errors.updateFailed": "Unable to update the model.",
  "admin.models.feedback.created":
    "Model \"{{model}}\" added successfully.",
  "admin.models.feedback.updated":
    "Model \"{{model}}\" updated successfully.",
  "admin.models.feedback.deleted": "Model \"{{model}}\" deleted.",
  "admin.models.table.previousResponseId": "Incremental responses",
  "admin.models.table.reasoningSummary": "Reasoning summary",
  "admin.models.table.editAction": "Edit",
  "admin.models.table.deleteAction": "Delete",
  "admin.appSettings.page.title": "General settings",
  "admin.appSettings.page.subtitle": "Control ChatKit's global behaviour.",
  "admin.appSettings.threadTitle.cardTitle": "Automatic thread titles prompt",
  "admin.appSettings.threadTitle.cardDescription":
    "Customize the prompt used to name chat threads automatically.",
  "admin.appSettings.threadTitle.fieldLabel": "Thread title prompt",
  "admin.appSettings.threadTitle.placeholder":
    "Describe the instructions to generate a thread title…",
  "admin.appSettings.threadTitle.hint":
    "Provide concise instructions for the assistant.",
  "admin.appSettings.threadTitle.status.custom":
    "A custom prompt is currently active.",
  "admin.appSettings.threadTitle.status.default":
    "The default prompt is in use.",
  "admin.appSettings.threadTitle.defaultLabel": "Default prompt",
  "admin.appSettings.threadTitle.modelLabel": "Thread title model",
  "admin.appSettings.threadTitle.modelPlaceholder":
    "Select a model",
  "admin.appSettings.threadTitle.modelHint":
    "Pick a model from the list or choose the custom option to type an identifier.",
  "admin.appSettings.threadTitle.modelStatus.custom":
    "A custom model is currently active.",
  "admin.appSettings.threadTitle.modelStatus.default":
    "The default model is in use.",
  "admin.appSettings.threadTitle.modelDefaultLabel": "Default model",
  "admin.appSettings.threadTitle.modelLoadingOption":
    "Loading models…",
  "admin.appSettings.threadTitle.modelCustomOption": "Custom model…",
  "admin.appSettings.threadTitle.modelCustomLabel": "Custom model identifier",
  "admin.appSettings.model.cardTitle": "Model provider",
  "admin.appSettings.model.cardDescription":
    "Control the provider used to run ChatKit agents.",
  "admin.appSettings.model.enableCustomLabel":
    "Override environment configuration",
  "admin.appSettings.model.customConfigHint":
    "Provide one or more providers, their base URLs and API keys to use a custom proxy.",
  "admin.appSettings.model.environmentSummary":
    "Current configuration: provider {{provider}}, base {{base}}.",
  "admin.appSettings.model.providerUnknown": "unknown",
  "admin.appSettings.model.baseUnknown": "not set",
  "admin.appSettings.model.providerLabel": "Model provider",
  "admin.appSettings.model.providerOpenAI": "OpenAI (public API)",
  "admin.appSettings.model.providerLiteLLM":
    "LiteLLM (OpenAI-compatible proxy)",
  "admin.appSettings.model.providerCustom": "Other provider…",
  "admin.appSettings.model.providerNameLabel": "Provider identifier",
  "admin.appSettings.model.providerNamePlaceholder": "e.g. gemini, claude, litellm",
  "admin.appSettings.model.defaultProviderLabel": "Set as default provider",
  "admin.appSettings.model.removeProvider": "Remove this provider",
  "admin.appSettings.model.addProvider": "Add provider",
  "admin.appSettings.model.apiBaseLabel": "API base URL",
  "admin.appSettings.model.apiBaseHint":
    "The URL must start with http:// or https:// and point to the proxy to use.",
  "admin.appSettings.model.apiKeyLabel": "API key",
  "admin.appSettings.model.apiKeyPlaceholder":
    "Enter a new key to store it on the server",
  "admin.appSettings.model.apiKeyHelp":
    "Leave empty to keep the current key or use the environment variable.",
  "admin.appSettings.model.apiKeyStoredHint":
    "A key is stored ({{hint}}). Enter a new key to replace it.",
  "admin.appSettings.model.apiKeyUnknownHint": "hidden value",
  "admin.appSettings.model.apiKeyClearLabel": "Remove the stored key",
  "admin.appSettings.success.saved": "Settings saved successfully.",
  "admin.appSettings.success.reset": "Default prompt and model restored.",
  "admin.appSettings.errors.loadFailed": "Unable to load general settings.",
  "admin.appSettings.errors.saveFailed": "Unable to save the custom prompt.",
  "admin.appSettings.errors.resetFailed": "Unable to reset the prompt.",
  "admin.appSettings.errors.promptRequired":
    "The prompt must contain at least one character.",
  "admin.appSettings.errors.threadTitleModelRequired":
    "Enter the model used for automatic titles.",
  "admin.appSettings.errors.threadTitleModelsLoadFailed":
    "Unable to load the list of available models.",
  "admin.appSettings.errors.invalidSipPort":
    "The SIP port must be an integer between 1 and 65535.",
  "admin.appSettings.errors.invalidSipTransport":
    "The SIP transport must be empty or one of udp, tcp, tls.",
  "admin.appSettings.errors.sessionExpired":
    "Session expired, please sign in again.",
  "admin.appSettings.errors.modelProviderRequired":
    "Provide the provider identifier when the custom configuration is enabled.",
  "admin.appSettings.errors.modelApiBaseRequired":
    "Provide the provider base URL when the custom configuration is enabled.",
  "admin.appSettings.errors.modelProvidersRequired":
    "Add at least one provider when the custom configuration is enabled.",
  "admin.appSettings.errors.modelDefaultRequired":
    "Select a default provider.",
  "admin.appSettings.errors.invalidModelApiBase":
    "The provider base URL must be valid and use http or https.",
  "admin.appSettings.actions.save": "Save settings",
  "admin.appSettings.actions.reset": "Revert to defaults",
  "admin.appSettings.sipTrunk.cardTitle": "SIP trunk",
  "admin.appSettings.sipTrunk.cardDescription":
    "Configure the SIP access used for inbound telephony.",
  "admin.appSettings.sipTrunk.uriLabel": "SIP trunk URI",
  "admin.appSettings.sipTrunk.uriPlaceholder": "e.g. sip:pbx.example.com",
  "admin.appSettings.sipTrunk.usernameLabel": "SIP username",
  "admin.appSettings.sipTrunk.usernamePlaceholder": "Optional username",
  "admin.appSettings.sipTrunk.passwordLabel": "SIP password",
  "admin.appSettings.sipTrunk.passwordPlaceholder": "Password (optional)",
  "admin.appSettings.sipTrunk.passwordHelp":
    "Leave empty to remove the stored password.",
  "admin.appSettings.sipTrunk.contactHostLabel": "SIP contact host",
  "admin.appSettings.sipTrunk.contactHostPlaceholder": "e.g. 192.0.2.10",
  "admin.appSettings.sipTrunk.contactHostHelp":
    "Leave empty to let ChatKit detect the outbound IP address automatically.",
  "admin.appSettings.sipTrunk.contactPortLabel": "SIP contact port",
  "admin.appSettings.sipTrunk.contactPortPlaceholder": "e.g. 5070",
  "admin.appSettings.sipTrunk.contactTransportLabel": "SIP contact transport",
  "admin.appSettings.sipTrunk.contactTransportOptionDefault": "Use default value",
  "admin.appSettings.sipTrunk.contactTransportOptionUdp": "UDP",
  "admin.appSettings.sipTrunk.contactTransportOptionTcp": "TCP",
  "admin.appSettings.sipTrunk.contactTransportOptionTls": "TLS",
  "admin.appSettings.sipTrunk.contactTransportHelp":
    "Select the transport advertised in the Contact header (leave empty for the default).",
  "auth.login.title": "Sign in",
  "auth.login.subtitle": "Access the admin console to manage users and ChatKit sessions.",
  "auth.login.email.label": "Email address",
  "auth.login.email.placeholder": "you@example.com",
  "auth.login.password.label": "Password",
  "auth.login.password.placeholder": "••••••••",
  "auth.login.submit.loading": "Signing in…",
  "auth.login.submit.label": "Sign in",
  "auth.login.error.failure": "Sign-in failed",
  "auth.login.error.unexpected": "An unexpected error occurred",
  "auth.login.error.unreachable": "Unable to reach the authentication backend",
  "layout.menu.openSidebar": "Open global navigation",
  "settings.page.title": "Settings",
  "settings.page.subtitle": "Tailor the ChatKit experience to your needs.",
  "settings.page.navLabel": "Settings navigation",
  "settings.sections.preferences.label": "Preferences",
  "settings.sections.preferences.description": "Tailor the ChatKit experience to your needs.",
  "docs.title": "Documentation",
  "docs.subtitle": "Browse internal guides and reference material.",
  "docs.list.loading": "Loading documentation…",
  "docs.list.error": "Unable to load documentation.",
  "docs.list.empty": "No documents are available yet.",
  "docs.list.create": "Create document",
  "docs.list.language": "Language: {{language}}",
  "docs.list.updatedAt": "Updated {{value}}",
  "docs.list.open": "Open",
  "docs.errors.sessionExpired": "Session expired, please sign in again.",
  "docs.editor.title.create": "Create document",
  "docs.editor.title.edit": "Edit document",
  "docs.editor.fields.slug": "Identifier (slug)",
  "docs.editor.fields.title": "Title",
  "docs.editor.fields.summary": "Summary",
  "docs.editor.fields.content": "Markdown content",
  "docs.editor.actions.cancel": "Cancel",
  "docs.editor.actions.create": "Create",
  "docs.editor.actions.save": "Save",
  "docs.editor.saving": "Saving…",
  "docs.editor.creating": "Creating…",
  "docs.editor.error.requiredSlug": "The slug is required.",
  "docs.editor.error.unexpected": "An unexpected error occurred.",
  "docs.detail.loading": "Loading document…",
  "docs.detail.error": "Unable to load this document.",
  "docs.detail.missing": "Document not found.",
  "docs.detail.back": "← Back to docs",
  "docs.detail.edit": "Edit",
  "docs.detail.delete": "Delete",
  "docs.detail.delete.confirm": "Delete the document “{{title}}”?",
  "docs.detail.updatedAt": "Updated {{value}}",
  "docs.detail.language": "Language: {{language}}",
  "docs.detail.empty": "This document does not contain any content yet.",
  "docs.detail.fallbackTitle": "Document",
  "settings.modal.title": "Quick settings",
  "settings.modal.subtitle": "Jump straight to the key areas of your workspace.",
  "settings.modal.close": "Close settings",
  "settings.modal.navLabel": "Settings sections",
  "settings.preferences.language.title": "Interface language",
  "settings.preferences.language.description":
    "Choose which language is used throughout the application.",
  "settings.preferences.language.label": "Preferred language",
  "settings.preferences.language.hint":
    "ChatKit automatically detects your browser language the first time you sign in.",
  "Propriétés de l'arête sélectionnée": "Selected edge properties",
  "Connexion sélectionnée": "Selected connection",
  "Supprimer cette connexion": "Delete this connection",
  "Depuis": "From",
  "Vers": "To",
  "Branche conditionnelle": "Conditional branch",
  "Laisser vide pour la branche par défaut": "Leave blank for the default branch",
  "Attribuez un nom unique (ex. approuve, rejeté). Laissez vide pour définir la branche par défaut.":
    "Give the branch a unique name (e.g. approve, reject). Leave it blank to set the default branch.",
  "Libellé affiché": "Display label",
  "workflowBuilder.actions.importJson": "Import JSON",
  "workflowBuilder.agentInspector.modelLabel": "Available model",
  "workflowBuilder.agentInspector.modelHelp": "Choose a model available for this block.",
  "workflowBuilder.agentInspector.modelPlaceholder": "Select a model",
  "workflowBuilder.agentInspector.reasoningSuffix": " – reasoning",
  "workflowBuilder.agentInspector.providerLabel": "Provider",
  "workflowBuilder.agentInspector.providerPlaceholder": "All providers",
  "workflowBuilder.agentInspector.nestedWorkflowLabel": "Nested workflow",
  "workflowBuilder.agentInspector.nestedWorkflowHelp":
    "Choose another workflow to run instead of this agent.",
  "workflowBuilder.agentInspector.nestedWorkflowNoneOption": "Select a workflow",
  "workflowBuilder.agentInspector.nestedWorkflowCustomOption": "Custom",
  "workflowBuilder.agentInspector.nestedWorkflowLocalOption": "Local workflow",
  "workflowBuilder.agentInspector.nestedWorkflowHostedOption": "Hosted workflow",
  "workflowBuilder.agentInspector.nestedWorkflowHostedSelectLabel": "Hosted workflow",
  "workflowBuilder.agentInspector.nestedWorkflowHostedLoading": "Loading workflows…",
  "workflowBuilder.agentInspector.nestedWorkflowHostedSelectEmpty": "No hosted workflows available",
  "workflowBuilder.agentInspector.nestedWorkflowHostedIdLabel": "Workflow ID",
  "workflowBuilder.agentInspector.nestedWorkflowHostedIdPlaceholder": "e.g. 123",
  "workflowBuilder.agentInspector.nestedWorkflowMissing":
    "The selected workflow is no longer available.",
  "workflowBuilder.agentInspector.nestedWorkflowSlugInfo":
    "Workflow selected via slug \"{{slug}}\".",
  "workflowBuilder.agentInspector.nestedWorkflowSelectedInfo":
    "The remaining settings are hidden because this block delegates to the nested workflow “{{label}}”.",
  "workflowBuilder.agentInspector.nestedWorkflowSelectedInfoUnknown":
    "The remaining settings are hidden because this block delegates to a nested workflow.",
  "workflowBuilder.agentInspector.unlistedModelWarning":
    "This block currently uses an unlisted model ({{model}}). Pick a model from the list above.",
  "workflowBuilder.agentInspector.workflowToolsTitle": "ChatKit workflows",
  "workflowBuilder.agentInspector.workflowToolsDescription":
    "Expose these workflows as tools that the agent can call through function calls.",
  "workflowBuilder.agentInspector.workflowToolsToggleHelp":
    "Expose the \"{{slug}}\" workflow as a callable tool.",
  "workflowBuilder.agentInspector.workflowToolsEmpty":
    "No other workflows are available to expose as tools.",
  "workflowBuilder.agentInspector.workflowToolsMissing":
    "The \"{{slug}}\" workflow is no longer available. Remove it from the configuration.",
  "workflowBuilder.agentInspector.mcpSectionTitle": "MCP server",
  "workflowBuilder.agentInspector.mcpSectionDescription":
    "Connect an existing MCP server to expose its tools to the agent.",
  "workflowBuilder.agentInspector.mcpEnabledLabel": "Enable MCP server",
  "workflowBuilder.agentInspector.mcpEnabledHelp":
    "Turn off to temporarily remove the MCP integration from this agent while keeping the details.",
  "workflowBuilder.agentInspector.mcpDisabledInfo":
    "Enable the MCP server to configure its URL and run connection tests.",
  "workflowBuilder.agentInspector.mcpUrlLabel": "MCP server URL",
  "workflowBuilder.agentInspector.mcpAuthorizationLabel":
    "Authorization header (Bearer …)",
  "workflowBuilder.agentInspector.mcpAuthorizationPlaceholder": "Bearer …",
  "workflowBuilder.agentInspector.mcpAuthorizationHelp":
    "Leave empty if the server does not require authentication.",
  "workflowBuilder.agentInspector.mcpClientIdLabel": "Client ID (optional)",
  "workflowBuilder.agentInspector.mcpClientIdPlaceholder": "OAuth2 client ID",
  "workflowBuilder.agentInspector.mcpScopeLabel": "OAuth scopes (optional)",
  "workflowBuilder.agentInspector.mcpScopePlaceholder": "e.g. profile email",
  "workflowBuilder.agentInspector.mcpScopeHelp":
    "Separate scopes with spaces. Leave empty to rely on the provider defaults.",
  "workflowBuilder.agentInspector.mcpOAuthButton": "Connect via OAuth",
  "workflowBuilder.agentInspector.mcpOAuthStatus.starting":
    "Starting OAuth flow…",
  "workflowBuilder.agentInspector.mcpOAuthStatus.pending":
    "Authorize the connection in the popup window, then return here.",
  "workflowBuilder.agentInspector.mcpOAuthStatus.success":
    "OAuth token saved successfully.",
  "workflowBuilder.agentInspector.mcpOAuthStatus.error":
    "OAuth authentication failed.",
  "workflowBuilder.agentInspector.mcpOAuthStatus.errorWithDetail":
    "OAuth authentication failed: {{detail}}",
  "workflowBuilder.agentInspector.mcpOAuthStatus.windowBlocked":
    "The authorization window could not be opened. Allow pop-ups and try again.",
  "workflowBuilder.agentInspector.mcpOAuthStatus.sessionExpired":
    "The OAuth session expired. Restart the authentication.",
  "workflowBuilder.agentInspector.mcpOAuthStatus.noAccessToken":
    "The OAuth provider did not return an access token.",
  "workflowBuilder.agentInspector.mcpOAuthStatus.unknownError": "unknown error",
  "workflowBuilder.agentInspector.mcpTestButton": "Test connection",
  "workflowBuilder.agentInspector.mcpTestStatus.ok":
    "Connection established. {{count}} tool(s) available.",
  "workflowBuilder.agentInspector.mcpTestStatus.unauthorized":
    "Authentication rejected by the MCP server.",
  "workflowBuilder.agentInspector.mcpTestStatus.forbidden":
    "Access denied by the MCP server.",
  "workflowBuilder.agentInspector.mcpTestStatus.http_error":
    "The MCP server returned HTTP status {{statusCode}}.",
  "workflowBuilder.agentInspector.mcpTestStatus.timeout":
    "The MCP server did not respond before the timeout.",
  "workflowBuilder.agentInspector.mcpTestStatus.error":
    "Unable to test the connection: {{detail}}",
  "workflowBuilder.agentInspector.mcpTestStatus.invalidConfig":
    "Provide a valid MCP URL before running the test.",
  "workflowBuilder.agentInspector.mcpTestStatus.loading": "Testing connection…",
  "workflowBuilder.agentInspector.mcpTestStatus.toolListLabel": "Available tools",
  "workflowBuilder.agentInspector.mcpTestStatus.errorUnknown": "unknown error",
  "workflowBuilder.agentInspector.modelsLoading": "Loading available models…",
  "workflowBuilder.agentInspector.imageToolToggleHelp":
    "Enables the image_generation tool to produce visuals. At the moment, only OpenAI's Images API is supported.",
  "workflowBuilder.agentInspector.imageModelHelp":
    "Select a supported image model. Currently only OpenAI variants are available.",
  "workflowBuilder.agentInspector.computerUseToggle": "Enable computer-use tool",
  "workflowBuilder.agentInspector.computerUseToggleHelp":
    "Allows the agent to control a hosted computer, launching a dedicated browser.",
  "workflowBuilder.agentInspector.computerUseWidthLabel": "Screen width (px)",
  "workflowBuilder.agentInspector.computerUseHeightLabel": "Screen height (px)",
  "workflowBuilder.agentInspector.computerUseEnvironmentLabel": "Environment",
  "workflowBuilder.agentInspector.computerUseEnvironment.browser": "Browser",
  "workflowBuilder.agentInspector.computerUseEnvironment.mac": "macOS",
  "workflowBuilder.agentInspector.computerUseEnvironment.windows": "Windows",
  "workflowBuilder.agentInspector.computerUseEnvironment.ubuntu": "Ubuntu",
  "workflowBuilder.agentInspector.computerUseStartUrlLabel": "Initial URL (optional)",
  "workflowBuilder.agentInspector.computerUseStartUrlHelp":
    "Load this address as soon as the controlled session starts (leave blank for the default page).",
  "workflowBuilder.agentInspector.computerUseStartUrlPlaceholder": "https://example.com",
  "workflowBuilder.startInspector.autoRunLabel": "Start automatically",
  "workflowBuilder.startInspector.autoRunHelp":
    "Runs the workflow as soon as a thread opens, even without a user message.",
  "workflowBuilder.startInspector.autoRunUserMessageLabel": "Initial user message",
  "workflowBuilder.startInspector.autoRunUserMessagePlaceholder":
    "e.g. Hello, here is the starting context… (optional)",
  "workflowBuilder.startInspector.autoRunUserMessageHint":
    "This message is sent to the agent when a thread starts without user input. Entering an assistant message below clears it automatically.",
  "workflowBuilder.startInspector.autoRunAssistantMessageLabel": "Initial assistant message",
  "workflowBuilder.startInspector.autoRunAssistantMessagePlaceholder":
    "e.g. Hello, I'm your assistant… (optional)",
  "workflowBuilder.startInspector.autoRunAssistantMessageHint":
    "This message is delivered as the assistant's first reply when auto-start triggers. Add a user message above to disable it.",
  "workflowBuilder.startInspector.hostedSectionTitle": "Hosted workflows",
  "workflowBuilder.startInspector.hostedSectionDescription":
    "Expose ChatKit hosted workflows directly from this Start block.",
  "workflowBuilder.startInspector.hostedEmpty":
    "No hosted workflow is configured yet.",
  "workflowBuilder.startInspector.hostedAddButton": "Add a hosted workflow",
  "workflowBuilder.startInspector.hostedSlugLabel": "Hosted workflow slug",
  "workflowBuilder.startInspector.hostedSlugPlaceholder": "e.g. support-pro",
  "workflowBuilder.startInspector.hostedSlugHelp":
    "Human-readable identifier used to distinguish each hosted workflow.",
  "workflowBuilder.startInspector.hostedSlugErrorRequired": "Slug is required.",
  "workflowBuilder.startInspector.hostedSlugErrorDuplicate":
    "Each slug must be unique.",
  "workflowBuilder.startInspector.hostedLabelLabel": "Display label",
  "workflowBuilder.startInspector.hostedLabelPlaceholder":
    "Name shown in the chat sidebar",
  "workflowBuilder.startInspector.hostedWorkflowIdLabel":
    "Hosted workflow ID",
  "workflowBuilder.startInspector.hostedWorkflowIdPlaceholder":
    "ID from the ChatKit console",
  "workflowBuilder.startInspector.hostedWorkflowIdHelp":
    "Copy the workflow identifier published in the ChatKit console.",
  "workflowBuilder.startInspector.hostedWorkflowIdError":
    "Enter the hosted workflow identifier.",
  "workflowBuilder.startInspector.hostedDescriptionLabel": "Description (optional)",
  "workflowBuilder.startInspector.hostedDescriptionPlaceholder":
    "Internal note or tooltip shown in the UI",
  "workflowBuilder.startInspector.hostedRemoveButton": "Remove this hosted workflow",
  "workflowBuilder.startInspector.telephonyIsSipWorkflowLabel": "SIP calls workflow",
  "workflowBuilder.startInspector.telephonyIsSipWorkflowHelp":
    "Enable this option to use this workflow for incoming SIP calls. Only one workflow can be configured as the SIP workflow at a time. Voice parameters will be taken from the voice-agent block in the workflow.",
  "workflowBuilder.startInspector.telephonyRingTimeoutLabel": "Ring timeout (seconds)",
  "workflowBuilder.startInspector.telephonyRingTimeoutHelp":
    "Duration the phone will ring before the voice agent answers. Value between 0 and 30 seconds.",
  "workflows.hostedBadge": "Hosted",
  "workflows.hostedUnavailable": "Unavailable right now.",
  "workflows.hostedCompactLabel": "{label} (hosted)",
  "workflowBuilder.createWorkflow.modal.title": "New workflow",
  "workflowBuilder.createWorkflow.modal.typeLabel": "Type",
  "workflowBuilder.createWorkflow.modal.typeLocal": "Local",
  "workflowBuilder.createWorkflow.modal.typeHosted": "Hosted",
  "workflowBuilder.createWorkflow.modal.nameLabel": "Workflow name",
  "workflowBuilder.createWorkflow.modal.remoteIdLabel": "Hosted workflow ID",
  "workflowBuilder.createWorkflow.modal.submit": "Create",
  "workflowBuilder.createWorkflow.modal.cancel": "Cancel",
  "workflowBuilder.createWorkflow.openModal": "Create a workflow",
  "workflowBuilder.createWorkflow.errorMissingName": "Workflow name is required.",
  "workflowBuilder.createWorkflow.errorMissingRemoteId":
    "Hosted workflow identifier is required.",
  "workflowBuilder.createWorkflow.creatingHosted": "Creating hosted workflow…",
  "workflowBuilder.createWorkflow.successHosted":
    "Hosted workflow \"{label}\" added successfully.",
  "workflowBuilder.createWorkflow.errorCreateHosted":
    "Unable to create hosted workflow.",
  "workflowBuilder.createWorkflow.errorAuthentication":
    "You must be signed in to manage hosted workflows.",
  "workflowBuilder.createWorkflow.successLocal":
    "Workflow \"{name}\" created successfully.",
  "workflowBuilder.createWorkflow.errorCreateLocal":
    "Unable to create the workflow.",
  "workflowBuilder.hostedSection.title": "Hosted workflows",
  "workflowBuilder.hostedSection.loading": "Loading hosted workflows…",
  "workflowBuilder.hostedSection.empty":
    "No hosted workflow managed from the interface yet.",
  "workflowBuilder.hostedSection.deleteAction": "Delete",
  "workflowBuilder.hostedSection.remoteId": "Remote ID: {id}",
  "workflowBuilder.hostedSection.deleting": "Deleting hosted workflow…",
  "workflowBuilder.hostedSection.deleteSuccess":
    "Hosted workflow \"{label}\" removed.",
  "workflowBuilder.hostedSection.deleteError":
    "Unable to delete the hosted workflow.",
  "workflowBuilder.hostedSection.loadError":
    "Unable to load hosted workflows.",
  "workflowBuilder.hostedSection.confirmDelete":
    "Delete hosted workflow \"{label}\"? This action cannot be undone.",
  "workflowBuilder.save.autoSaveSuccess": "Changes saved automatically.",
  "workflowBuilder.save.draftDisplayName": "Draft",
  "workflowBuilder.save.failure": "Unable to save the workflow.",
  "workflowBuilder.save.failureWithStatus": "Save failed (status {{status}}).",
  "workflowBuilder.actions.exportJson": "Export as JSON",
  "workflowBuilder.export.preparing": "Preparing export…",
  "workflowBuilder.export.success": "JSON export downloaded.",
  "workflowBuilder.export.error": "Unable to export the workflow.",
  "workflowBuilder.export.errorWithStatus": "Unable to export the workflow (status {{status}}).",
  "workflowBuilder.mobileActions.open": "Show actions",
  "workflowBuilder.mobileActions.title": "Workflow actions",
  "workflowBuilder.mobileActions.close": "Close",
  "workflowBuilder.mobileActions.properties": "Block properties",
  "workflowBuilder.mobileActions.duplicate": "Duplicate selection",
  "workflowBuilder.mobileActions.delete": "Delete selection",
  "workflowBuilder.deleteBlock.confirm":
    "Delete the \"{{name}}\" block? This action cannot be undone.",
  "workflowBuilder.deleteSelection.confirmSingle":
    "Delete the selected block? This action cannot be undone.",
  "workflowBuilder.deleteSelection.confirmMultiple":
    "Delete the {{count}} selected blocks? This action cannot be undone.",
  "workflowBuilder.mobileActions.undo": "Undo (Ctrl+Z)",
  "workflowBuilder.mobileActions.redo": "Redo (Ctrl+Y)",
  "workflowBuilder.preview.enter": "Enter preview",
  "workflowBuilder.preview.exit": "Exit preview",
  "workflowBuilder.preview.title": "Preview chat",
  "workflowBuilder.preview.banner": "Preview mode enabled – editing is locked.",
  "workflowBuilder.preview.initializing": "Initializing session…",
  "workflowBuilder.preview.composerPlaceholder": "Send a message to try this workflow…",
  "workflowBuilder.preview.untitled": "Untitled workflow",
  "workflowBuilder.preview.draftLabel": "Draft",
  "workflowBuilder.preview.versionLabel": "Version v{{version}}",
  "workflowBuilder.duplicate.success": "Selection duplicated.",
  "workflowBuilder.duplicate.empty": "Select a block to duplicate.",
  "workflowBuilder.duplicate.error": "Unable to duplicate the selection.",
  "workflowBuilder.import.inProgress": "Importing…",
  "workflowBuilder.import.saving": "Importing workflow…",
  "workflowBuilder.import.success": "Workflow imported successfully.",
  "workflowBuilder.import.error": "Unable to import the workflow.",
  "workflowBuilder.import.errorInvalidJson": "The file does not contain valid JSON.",
  "workflowBuilder.import.errorInvalidGraph": "The JSON does not describe a valid workflow graph.",
  "workflowBuilder.import.errorInvalidNode": "A workflow block is invalid.",
  "workflowBuilder.import.errorInvalidEdge": "A workflow connection is invalid.",
  "workflowBuilder.import.errorMissingNodes": "The JSON does not contain any workflow nodes.",
  "workflowBuilder.import.errorMissingName": "A name is required for the imported workflow.",
  "workflowBuilder.import.errorFileRead": "Unable to read the selected file.",
  "workflowBuilder.import.promptDisplayName": "Name for the imported workflow?",
  "workflowBuilder.import.defaultVersionName": "Import on {{timestamp}}",
  "workflowBuilder.import.errorWithStatus": "Unable to import the workflow (status {{status}}).",
  "workflowBuilder.clipboard.copySelectionSuccess": "Selection copied to clipboard.",
  "workflowBuilder.clipboard.copyAllSuccess": "Entire workflow copied to clipboard.",
  "workflowBuilder.clipboard.copyEmpty": "No blocks to copy.",
  "workflowBuilder.clipboard.copyError": "Unable to copy selection.",
  "workflowBuilder.clipboard.pasteEmpty": "Clipboard is empty.",
  "workflowBuilder.clipboard.pasteInvalid": "Clipboard does not contain a valid workflow.",
  "workflowBuilder.clipboard.pasteNothing": "Nothing to paste.",
  "workflowBuilder.clipboard.pasteError": "Unable to paste workflow.",
  "workflowBuilder.clipboard.pasteSuccess": "Blocks pasted from clipboard.",
  "workflowBuilder.deploy.missingTarget": "No version available for promotion.",
  "workflowBuilder.deploy.pendingChangesError": "Saving changes is required before deployment.",
  "workflowBuilder.deploy.promoting": "Promoting the selected version…",
  "workflowBuilder.deploy.successProduction": "Selected version deployed to production.",
  "workflowBuilder.deploy.successPublished": "Selected version published.",
  "workflowBuilder.deploy.promoteFailedWithStatus": "Promotion failed (status {{status}}).",
  "workflowBuilder.deploy.promoteError": "Unable to promote the selected version.",
  "workflowBuilder.deploy.publishError": "Unable to publish the workflow.",
  "workflowBuilder.deploy.modal.titlePublishDraft": "Publish changes?",
  "workflowBuilder.deploy.modal.descriptionPublishDraft":
    "Create a new version of the workflow with your latest changes.",
  "workflowBuilder.deploy.modal.titlePromoteSelected": "Deploy selected version?",
  "workflowBuilder.deploy.modal.descriptionPromoteSelected":
    "Replace the current production version with revision v{{version}}.",
  "workflowBuilder.deploy.modal.titleMissing": "Select a version to deploy",
  "workflowBuilder.deploy.modal.descriptionMissing":
    "Choose a draft or existing version to promote.",
  "workflowBuilder.deploy.modal.path.draft": "Draft",
  "workflowBuilder.deploy.modal.path.newVersion": "New version",
  "workflowBuilder.deploy.modal.path.selectedWithVersion": "Selected version v{{version}}",
  "workflowBuilder.deploy.modal.path.production": "Production",
  "workflowBuilder.deploy.modal.productionToggle": "Deploy to production",
  "workflowBuilder.deploy.modal.action.cancel": "Cancel",
  "workflowBuilder.deploy.modal.action.publish": "Publish",
  "workflowBuilder.deploy.modal.action.deploy": "Deploy",
  "workflowBuilder.voiceInspector.modelLabel": "Realtime model",
  "workflowBuilder.voiceInspector.voiceLabel": "Voice ID",
  "workflowBuilder.voiceInspector.instructionsLabel": "Realtime instructions",
  "workflowBuilder.voiceInspector.instructionsPlaceholder":
    "Guidance shared with the voice assistant",
  "workflowBuilder.voiceInspector.startBehaviorLabel": "Session start",
  "workflowBuilder.voiceInspector.stopBehaviorLabel": "Session stop",
  "workflowBuilder.voiceInspector.start.manual": "Manual start",
  "workflowBuilder.voiceInspector.start.auto": "Automatically when the block runs",
  "workflowBuilder.voiceInspector.stop.manual": "Manual stop (keep session active)",
  "workflowBuilder.voiceInspector.stop.auto": "Stop automatically after the response",
  "workflowBuilder.voiceInspector.toolsLabel": "Realtime tools",
  "workflowBuilder.voiceInspector.tool.response": "Audio responses",
  "workflowBuilder.voiceInspector.tool.transcription": "Speech-to-text transcripts",
  "workflowBuilder.voiceInspector.tool.functionCall": "Function calling",
  "workflowBuilder.voiceInspector.tool.functionCall.help":
    "Enable function calls to invoke custom business logic.",
  "workflowBuilder.node.kind.start": "Start",
  "workflowBuilder.node.kind.agent": "Agent",
  "workflowBuilder.node.kind.voice_agent": "Voice agent",
  "workflowBuilder.node.kind.condition": "Condition",
  "workflowBuilder.node.kind.state": "State block",
  "workflowBuilder.node.kind.transform": "Transform block",
  "workflowBuilder.node.kind.watch": "Watch block",
  "workflowBuilder.node.kind.wait_for_user_input": "Wait for user input",
  "workflowBuilder.node.kind.assistant_message": "Assistant message",
  "workflowBuilder.node.kind.user_message": "User message",
  "workflowBuilder.node.kind.json_vector_store": "JSON vector store",
  "workflowBuilder.node.kind.parallel_split": "Parallel split",
  "workflowBuilder.node.kind.parallel_join": "Parallel join",
  "workflowBuilder.node.kind.widget": "Widget block",
  "workflowBuilder.node.kind.end": "End",
  "workflowBuilder.parallel.joinSlugLabel": "Associated join block",
  "workflowBuilder.parallel.joinSlugHelp": "Provide the slug of the matching parallel_join block.",
  "workflowBuilder.parallel.joinSlugPlaceholder": "e.g. parallel-join-1",
  "workflowBuilder.parallel.branchesTitle": "Parallel branches",
  "workflowBuilder.parallel.branchLabelLabel": "Branch {{index}} label",
  "workflowBuilder.parallel.branchLabelPlaceholder": "Label shown in the interface",
  "workflowBuilder.parallel.branchSlugLabel": "Internal identifier: {{slug}}",
  "workflowBuilder.parallel.branchRemove": "Remove",
  "workflowBuilder.parallel.branchAdd": "Add branch",
  "workflowBuilder.parallel.branchHint":
    "Create as many branches as outgoing connections from this block.",
  "workflowBuilder.parallel.branchMinimum":
    "At least two branches are required for a parallel split.",
  "vectorStore.ingestion.success.document":
    "Document “{{docId}}” ingested ({{chunkCount}} segment{{pluralSuffix}}).",
};

export const translations: Translations = {
  en,
  fr,
};

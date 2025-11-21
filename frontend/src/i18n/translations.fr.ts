import type { TranslationDictionary } from "./translations";

export const fr: TranslationDictionary = {
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
  "admin.tabs.providers": "Fournisseurs de modèles",
  "admin.tabs.vectorStores": "Vector stores",
  "admin.tabs.widgets": "Bibliothèque de widgets",
  "admin.tabs.mcpServers": "Serveurs MCP",
  "admin.tabs.telephony": "Téléphonie",
  "admin.tabs.workflowMonitor": "Workflows en cours",
  "admin.tabs.settings": "Paramètres généraux",
  "admin.tabs.appearance": "Apparence et thème",
  "admin.tabs.languages": "Langues",
  "admin.tabs.lti": "LTI",
  "admin.tabs.docs": "Documentation",
  "admin.tabs.preferences": "Préférences utilisateur",
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
  "admin.models.table.editAction": "Modifier",
  "admin.models.table.deleteAction": "Supprimer",
  "admin.modelProviders.page.title": "Fournisseurs de modèles",
  "admin.modelProviders.page.subtitle": "Configurez les connexions aux fournisseurs LLM et les paramètres API.",
  "admin.modelProviders.success.saved": "Configuration des fournisseurs enregistrée avec succès.",
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
  "admin.lti.page.title": "Intégrations LTI",
  "admin.lti.page.subtitle":
    "Gérez les émetteurs LTI autorisés à lancer ChatKit et consultez la clé publique de l'outil.",
  "admin.lti.toolSettings.keys.title": "Clés LTI",
  "admin.lti.toolSettings.keys.subtitle":
    "Consultez les chemins des clés gérées par le serveur et la clé publique actuelle.",
  "admin.lti.toolSettings.keys.privateKeyPath": "Clé privée",
  "admin.lti.toolSettings.keys.publicKeyPath": "Clé publique",
  "admin.lti.toolSettings.keys.lastUpdated": "Dernière mise à jour",
  "admin.lti.toolSettings.keys.publicKeyHeading": "Clé publique actuelle",
  "admin.lti.toolSettings.keys.readOnlyNotice":
    "Ces clés sont gérées en lecture seule depuis la configuration du serveur.",
  "admin.lti.toolSettings.keys.noData": "Non disponible",
  "admin.lti.toolSettings.errors.sessionExpired":
    "Session expirée, veuillez vous reconnecter.",
  "admin.lti.toolSettings.errors.loadFailed":
    "Impossible de charger les paramètres de l'outil.",
  "admin.lti.registrations.title": "Enregistrements plateformes",
  "admin.lti.registrations.subtitle":
    "Listez les émetteurs et leurs identifiants autorisés à lancer ChatKit via LTI.",
  "admin.lti.registrations.table.issuer": "Issuer",
  "admin.lti.registrations.table.clientId": "Client ID",
  "admin.lti.registrations.table.keySetUrl": "URL JWKS",
  "admin.lti.registrations.table.authorizationEndpoint": "Endpoint d'authentification",
  "admin.lti.registrations.table.tokenEndpoint": "Endpoint de jeton",
  "admin.lti.registrations.table.deepLinkReturnUrl": "URL de retour deep-link",
  "admin.lti.registrations.table.audience": "Audience",
  "admin.lti.registrations.table.updatedAt": "Mis à jour",
  "admin.lti.registrations.table.actions": "Actions",
  "admin.lti.registrations.table.empty": "Aucun enregistrement LTI configuré pour le moment.",
  "admin.lti.registrations.table.loading": "Chargement des enregistrements…",
  "admin.lti.registrations.form.createTitle": "Ajouter un enregistrement",
  "admin.lti.registrations.form.editTitle": "Modifier l'enregistrement",
  "admin.lti.registrations.form.issuerLabel": "URL de l'issuer",
  "admin.lti.registrations.form.clientIdLabel": "Client ID",
  "admin.lti.registrations.form.keySetUrlLabel": "URL JWKS",
  "admin.lti.registrations.form.authorizationEndpointLabel":
    "Endpoint d'authentification",
  "admin.lti.registrations.form.tokenEndpointLabel": "Endpoint de jeton",
  "admin.lti.registrations.form.deepLinkReturnUrlLabel":
    "URL de retour deep-link (optionnel)",
  "admin.lti.registrations.form.audienceLabel": "Audience (optionnel)",
  "admin.lti.registrations.form.save": "Enregistrer",
  "admin.lti.registrations.form.saving": "Enregistrement…",
  "admin.lti.registrations.form.cancel": "Annuler",
  "admin.lti.registrations.actions.edit": "Modifier",
  "admin.lti.registrations.actions.delete": "Supprimer",
  "admin.lti.registrations.confirm.delete":
    "Supprimer l'enregistrement pour {{issuer}} ?",
  "admin.lti.registrations.feedback.created":
    "Enregistrement pour {{issuer}} ajouté avec succès.",
  "admin.lti.registrations.feedback.updated":
    "Enregistrement pour {{issuer}} mis à jour avec succès.",
  "admin.lti.registrations.feedback.deleted": "Enregistrement supprimé.",
  "admin.lti.registrations.errors.sessionExpired":
    "Session expirée, veuillez vous reconnecter.",
  "admin.lti.registrations.errors.loadFailed":
    "Impossible de charger les enregistrements LTI.",
  "admin.lti.registrations.errors.saveFailed":
    "Impossible d'enregistrer la configuration.",
  "admin.lti.registrations.errors.deleteFailed":
    "Impossible de supprimer l'enregistrement.",
  "admin.lti.registrations.errors.missingFields":
    "Veuillez remplir tous les champs obligatoires avant d'enregistrer.",
  "admin.appSettings.model.providerNameLabel": "Identifiant du fournisseur",
  "admin.appSettings.model.providerNamePlaceholder": "ex. gemini, claude, litellm",
  "admin.appSettings.model.defaultProviderLabel":
    "Définir comme fournisseur par défaut",
  "admin.appSettings.model.defaultProviderBadge": "Par défaut",
  "admin.appSettings.model.removeProvider": "Supprimer ce fournisseur",
  "admin.appSettings.model.addProvider": "Ajouter un fournisseur",
  "admin.appSettings.model.apiBaseLabel": "URL de base de l'API (optionnel)",
  "admin.appSettings.model.apiBasePlaceholder":
    "Vide pour auto-routing, ou https://api.openai.com/v1",
  "admin.appSettings.model.apiBaseHint":
    "Pour LiteLLM avec auto-routing, laissez ce champ vide. Pour un serveur personnalisé ou OpenAI direct, entrez l'URL (ex: https://api.openai.com/v1).",
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
  "admin.appearance.page.title": "Apparence & thème",
  "admin.appearance.page.subtitle":
    "Personnalisez les couleurs, les polices et les messages d'accueil de ChatKit.",
  "admin.appearance.colorScheme.cardTitle": "Mode de couleur",
  "admin.appearance.colorScheme.cardDescription":
    "Choisissez le mode appliqué par défaut à l'ensemble des utilisateurs.",
  "admin.appearance.colorScheme.option.system": "Suivre le système",
  "admin.appearance.colorScheme.option.light": "Mode clair",
  "admin.appearance.colorScheme.option.dark": "Mode sombre",
  "admin.appearance.colors.cardTitle": "Couleurs de l'interface",
  "admin.appearance.colors.cardDescription":
    "Définissez la couleur d'accent et ajustez les surfaces si nécessaire.",
  "admin.appearance.colors.accentLabel": "Couleur d'accent",
  "admin.appearance.colors.accentHint":
    "Cette couleur est utilisée pour les boutons principaux et les éléments mis en avant.",
  "admin.appearance.colors.accentAria": "Choisir la couleur d'accent",
  "admin.appearance.colors.enableCustomSurfaces":
    "Activer des couleurs de surface personnalisées",
  "admin.appearance.colors.hueLabel": "Teinte",
  "admin.appearance.colors.tintLabel": "Luminosité (clair)",
  "admin.appearance.colors.shadeLabel": "Ombre (sombre)",
  "admin.appearance.typography.cardTitle": "Typographie",
  "admin.appearance.typography.cardDescription":
    "Appliquez des polices personnalisées à l'interface ChatKit.",
  "admin.appearance.typography.bodyLabel": "Police principale",
  "admin.appearance.typography.headingLabel": "Police des titres",
  "admin.appearance.typography.hint":
    "Saisissez une pile de polices séparées par des virgules avec des alternatives.",
  "admin.appearance.start.cardTitle": "Écran de démarrage",
  "admin.appearance.start.cardDescription":
    "Personnalisez le message de bienvenue et les instructions affichés avant le premier échange.",
  "admin.appearance.start.greetingLabel": "Message de bienvenue",
  "admin.appearance.start.promptLabel": "Phrase d'accroche",
  "admin.appearance.start.promptHint":
    "Saisissez une accroche par ligne. Ajoutez « Titre | Suggestion » pour personnaliser l'intitulé.",
  "admin.appearance.start.placeholderLabel": "Texte d'aide du champ de saisie",
  "admin.appearance.start.disclaimerLabel": "Avertissement",
  "admin.appearance.actions.save": "Enregistrer l'apparence",
  "admin.appearance.feedback.saved": "Apparence enregistrée avec succès.",
  "admin.appearance.feedback.error": "Impossible d'enregistrer l'apparence.",
  "admin.appearance.feedback.loadError":
    "Impossible de charger les paramètres d'apparence.",
  "admin.appearance.feedback.sessionExpired":
    "Session expirée, veuillez vous reconnecter.",
  "admin.appearance.loading": "Chargement des paramètres d'apparence…",
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
  "workflowBuilder.agentInspector.title": "Configuration de l'Agent",
  "workflowBuilder.agentInspector.description": "Configurez le comportement, le modèle, les outils et les paramètres avancés de votre agent IA.",
  "workflowBuilder.agentInspector.tab.basic": "Basique",
  "workflowBuilder.agentInspector.tab.model": "Modèle",
  "workflowBuilder.agentInspector.tab.tools": "Outils",
  "workflowBuilder.agentInspector.tab.advanced": "Avancé",
  "workflowBuilder.agentInspector.messageLabel": "Prompt Système",
  "workflowBuilder.agentInspector.messageHint": "Définit le rôle et le comportement de l'agent",
  "workflowBuilder.agentInspector.temperatureLabel": "Température",
  "workflowBuilder.agentInspector.maxTokensLabel": "Nombre Max de Tokens",
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
  "workflowBuilder.agentInspector.mcpServersTitle": "Serveurs MCP attribués",
  "workflowBuilder.agentInspector.mcpServersDescription":
    "Sélectionnez les serveurs MCP persistés et définissez les outils autorisés.",
  "workflowBuilder.agentInspector.mcpServersAddButton": "Ajouter un serveur MCP",
  "workflowBuilder.agentInspector.mcpServersRefreshButton": "Actualiser la liste",
  "workflowBuilder.agentInspector.mcpServersRefreshing": "Actualisation…",
  "workflowBuilder.agentInspector.mcpServersLoading": "Chargement des serveurs MCP…",
  "workflowBuilder.agentInspector.mcpServersLoadError":
    "Impossible de charger les serveurs MCP.",
  "workflowBuilder.agentInspector.mcpServersEmpty":
    "Aucun serveur MCP n'est encore disponible.",
  "workflowBuilder.agentInspector.mcpServersAuthorizationOverrideLabel":
    "En-tête Authorization personnalisé",
  "workflowBuilder.agentInspector.mcpServersAuthorizationStored":
    "En-tête enregistré : {{hint}}",
  "workflowBuilder.agentInspector.mcpServersCacheUpdated":
    "Cache actualisé : {{value}}",
  "workflowBuilder.agentInspector.mcpServersRestrictToggle":
    "Limiter aux outils sélectionnés",
  "workflowBuilder.agentInspector.mcpServersRestrictHelp":
    "Désactivez cette option pour autoriser tous les outils exposés par le serveur.",
  "workflowBuilder.agentInspector.mcpServersNoTools":
    "Aucun outil mis en cache pour ce serveur.",
  "workflowBuilder.agentInspector.mcpServersAddToolLabel": "Ajouter un outil",
  "workflowBuilder.agentInspector.mcpServersAddToolPlaceholder":
    "Nom d'outil (ex. fetch_weather)",
  "workflowBuilder.agentInspector.mcpServersAddToolButton": "Ajouter",
  "workflowBuilder.agentInspector.mcpServersProbeButton":
    "Rafraîchir le cache des outils",
  "workflowBuilder.agentInspector.mcpServersProbeLoading": "Actualisation en cours…",
  "workflowBuilder.agentInspector.mcpServersProbeSuccess":
    "{{count}} outil(s) mis à jour depuis le serveur.",
  "workflowBuilder.agentInspector.mcpServersProbeError":
    "Impossible d'actualiser les outils.",
  "workflowBuilder.agentInspector.mcpServersModalTitle": "Créer un serveur MCP",
  "workflowBuilder.agentInspector.mcpServersModalLabel": "Libellé",
  "workflowBuilder.agentInspector.mcpServersModalUrl": "URL du serveur MCP",
  "workflowBuilder.agentInspector.mcpServersModalClientSecret":
    "Secret client OAuth",
  "workflowBuilder.agentInspector.mcpServersModalAccessToken": "Jeton d'accès",
  "workflowBuilder.agentInspector.mcpServersModalRefreshToken": "Refresh token",
  "workflowBuilder.agentInspector.mcpServersModalCancel": "Annuler",
  "workflowBuilder.agentInspector.mcpServersModalSubmit": "Créer le serveur",
  "workflowBuilder.agentInspector.mcpServersModalSaving": "Enregistrement…",
  "workflowBuilder.agentInspector.mcpServersModalMissingFields":
    "Renseignez le libellé et l'URL du serveur MCP.",
  "workflowBuilder.agentInspector.mcpServersModalError":
    "Impossible d'enregistrer le serveur MCP.",
  "workflowBuilder.agentInspector.modelsLoading": "Chargement des modèles disponibles…",
  "workflowBuilder.agentInspector.tabsLabel": "Sections de configuration de l'agent",
  "workflowBuilder.agentInspector.messagePlaceholder": "Vous êtes un assistant serviable…",
  "workflowBuilder.agentInspector.systemPrompt.helpTitle": "Rédiger un prompt système efficace",
  "workflowBuilder.agentInspector.systemPrompt.helpDescription":
    "Décrivez le rôle, le ton et les attentes de cet agent. Mentionnez la conduite à adopter lorsqu'il manque d'informations.",
  "workflowBuilder.agentInspector.systemPrompt.helpHintSpecific":
    "✅ Fournissez des consignes concrètes (ton, public, règles d'escalade).",
  "workflowBuilder.agentInspector.systemPrompt.helpHintTone":
    "✅ Indiquez comment l'agent doit répondre lorsqu'il manque d'informations.",
  "workflowBuilder.agentInspector.systemPrompt.examples.support.label": "Support client",
  "workflowBuilder.agentInspector.systemPrompt.examples.support.value":
    "Tu es un agent de support client professionnel et empathique. Réponds de manière claire et concise. Si tu ne connais pas la réponse, transmets la demande à un agent humain.",
  "workflowBuilder.agentInspector.systemPrompt.examples.analytics.label": "Analyste de données",
  "workflowBuilder.agentInspector.systemPrompt.examples.analytics.value":
    "Tu es un·e analyste de données senior. Examine les données fournies, souligne les tendances marquantes et propose des recommandations actionnables.",
  "workflowBuilder.agentInspector.nestedWorkflowSectionTitle": "Déléguer à un autre workflow",
  "workflowBuilder.agentInspector.nestedWorkflowMode.custom": "Configurer localement",
  "workflowBuilder.agentInspector.nestedWorkflowMode.local": "Utiliser un workflow de cet espace",
  "workflowBuilder.agentInspector.nestedWorkflowMode.hosted": "Utiliser un workflow hébergé",
  "workflowBuilder.agentInspector.nestedWorkflowHostedHint":
    "Choisissez un workflow hébergé dans la liste pour déléguer tout le bloc agent.",
  "workflowBuilder.agentInspector.providerHint":
    "Filtrez la liste des modèles par fournisseur. Laissez vide pour afficher tous les modèles configurés.",
  "workflowBuilder.agentInspector.modelParametersTitle": "Paramètres du modèle",
  "workflowBuilder.agentInspector.modelParametersDescription":
    "Ajustez la profondeur de raisonnement et les paramètres d'échantillonnage du modèle sélectionné.",
  "workflowBuilder.agentInspector.reasoningEffortLabel": "Effort de raisonnement",
  "workflowBuilder.agentInspector.reasoningEffort.default": "Utiliser la valeur par défaut du modèle",
  "workflowBuilder.agentInspector.reasoningEffort.low": "Superficiel",
  "workflowBuilder.agentInspector.reasoningEffort.medium": "Équilibré",
  "workflowBuilder.agentInspector.reasoningEffort.high": "Maximal",
  "workflowBuilder.agentInspector.textVerbosityLabel": "Niveau de détail de la réponse",
  "workflowBuilder.agentInspector.textVerbosity.default": "Utiliser la valeur par défaut du modèle",
  "workflowBuilder.agentInspector.textVerbosity.low": "Concise",
  "workflowBuilder.agentInspector.textVerbosity.medium": "Équilibrée",
  "workflowBuilder.agentInspector.textVerbosity.high": "Détaillée",
  "workflowBuilder.agentInspector.reasoningSummaryLabel": "Résumé de raisonnement",
  "workflowBuilder.agentInspector.reasoningSummary.none": "Ne pas générer de résumé",
  "workflowBuilder.agentInspector.reasoningSummary.auto": "Résumé automatique",
  "workflowBuilder.agentInspector.reasoningSummary.detailed": "Résumé détaillé",
  "workflowBuilder.agentInspector.temperatureHelp":
    "Les valeurs basses rendent les réponses plus déterministes, les valeurs élevées augmentent la créativité.",
  "workflowBuilder.agentInspector.temperaturePlaceholder": "ex. 0.7",
  "workflowBuilder.agentInspector.topPLabel": "Top-p",
  "workflowBuilder.agentInspector.topPHint":
    "Limiter la masse de probabilité cumulée prise en compte lors de l'échantillonnage.",
  "workflowBuilder.agentInspector.topPPlaceholder": "ex. 0.9",
  "workflowBuilder.agentInspector.maxTokensHint":
    "Laissez vide pour utiliser la valeur par défaut du modèle.",
  "workflowBuilder.agentInspector.maxTokensPlaceholder": "Saisissez le nombre maximal de tokens",
  "workflowBuilder.agentInspector.webSearch.title": "Recherche web",
  "workflowBuilder.agentInspector.webSearch.contextLabel": "Taille du contexte",
  "workflowBuilder.agentInspector.webSearch.contextHint":
    "Choisissez la quantité de documents récupérés à envoyer à l'agent.",
  "workflowBuilder.agentInspector.webSearch.context.default": "Valeur par défaut du modèle",
  "workflowBuilder.agentInspector.webSearch.context.low": "Petit contexte",
  "workflowBuilder.agentInspector.webSearch.context.medium": "Contexte moyen",
  "workflowBuilder.agentInspector.webSearch.context.high": "Grand contexte",
  "workflowBuilder.agentInspector.webSearch.maxResultsLabel": "Nombre maximal de résultats",
  "workflowBuilder.agentInspector.webSearch.maxResultsHint":
    "L'API de recherche renvoie jusqu'à ce nombre de documents.",
  "workflowBuilder.agentInspector.webSearch.helpTitle": "Quand activer la recherche web",
  "workflowBuilder.agentInspector.webSearch.helpDescription":
    "Utilisez cet outil lorsque l'agent doit consulter des informations publiques à jour. Les résultats sont ajoutés au contexte.",
  "workflowBuilder.agentInspector.webSearch.location.city": "Ville",
  "workflowBuilder.agentInspector.webSearch.location.region": "Région",
  "workflowBuilder.agentInspector.webSearch.location.country": "Pays",
  "workflowBuilder.agentInspector.webSearch.location.type": "Précision",
  "workflowBuilder.agentInspector.fileSearch.title": "Recherche dans la base de connaissances",
  "workflowBuilder.agentInspector.fileSearch.vectorStoreLabel": "Vector store",
  "workflowBuilder.agentInspector.fileSearch.validation.noStores":
    "Créez un vector store dans la section dédiée avant d'activer la recherche documentaire.",
  "workflowBuilder.agentInspector.fileSearch.validation.missing":
    "Sélectionnez un vector store pour activer la recherche documentaire.",
  "workflowBuilder.agentInspector.fileSearch.validation.unavailable":
    "Le vector store sélectionné n'est plus disponible. Choisissez-en un autre.",
  "workflowBuilder.agentInspector.fileSearch.loading": "Chargement des vector stores…",
  "workflowBuilder.agentInspector.fileSearch.placeholder": "Sélectionnez un vector store",
  "workflowBuilder.agentInspector.fileSearch.helpTitle":
    "À propos de la recherche dans la base de connaissances",
  "workflowBuilder.agentInspector.fileSearch.helpDescription":
    "Permet à l'agent de rechercher dans votre base de connaissances privée avant de répondre. Les passages récupérés sont ajoutés au contexte.",
  "workflowBuilder.agentInspector.computerUse.title": "Outil d'utilisation de l'ordinateur",
  "workflowBuilder.agentInspector.image.title": "Génération d'images",
  "workflowBuilder.agentInspector.image.modelLabel": "Modèle",
  "workflowBuilder.agentInspector.image.sizeLabel": "Taille de sortie",
  "workflowBuilder.agentInspector.image.qualityLabel": "Qualité",
  "workflowBuilder.agentInspector.image.backgroundLabel": "Arrière-plan",
  "workflowBuilder.agentInspector.image.outputLabel": "Format de sortie",
  "workflowBuilder.agentInspector.image.partialImagesLabel": "Images partielles",
  "workflowBuilder.agentInspector.image.partialImagesHelp": "Nombre d'images intermédiaires à recevoir pendant la génération (0-3). Plus la valeur est élevée, plus vous recevrez d'aperçus progressifs.",
  "workflowBuilder.agentInspector.image.helpTitle": "À propos de la génération d'images",
  "workflowBuilder.agentInspector.image.helpDescription":
    "Permet à l'agent de générer ou d'éditer des images à partir de descriptions textuelles.",
  "workflowBuilder.agentInspector.image.model.gpt-image-1-mini": "gpt-image-1-mini",
  "workflowBuilder.agentInspector.image.model.gpt-image-1": "gpt-image-1",
  "workflowBuilder.agentInspector.image.size.1024x1024": "1024 × 1024",
  "workflowBuilder.agentInspector.image.size.1024x1536": "1024 × 1536",
  "workflowBuilder.agentInspector.image.size.1536x1024": "1536 × 1024",
  "workflowBuilder.agentInspector.image.size.auto": "Automatique",
  "workflowBuilder.agentInspector.image.quality.high": "Haute",
  "workflowBuilder.agentInspector.image.quality.medium": "Moyenne",
  "workflowBuilder.agentInspector.image.quality.low": "Faible",
  "workflowBuilder.agentInspector.image.quality.auto": "Automatique",
  "workflowBuilder.agentInspector.image.background.auto": "Automatique",
  "workflowBuilder.agentInspector.image.background.transparent": "Transparent",
  "workflowBuilder.agentInspector.image.background.opaque": "Opaque",
  "workflowBuilder.agentInspector.image.output.auto": "Automatique",
  "workflowBuilder.agentInspector.image.output.png": "PNG",
  "workflowBuilder.agentInspector.image.output.webp": "WebP",
  "workflowBuilder.agentInspector.image.output.jpeg": "JPEG",
  "workflowBuilder.agentInspector.functionToolsTitle": "Fonctions intégrées",
  "workflowBuilder.agentInspector.functionToolsDescription":
    "Active les fonctions internes, les serveurs MCP et les workflows disponibles comme outils pour cet agent.",
  "workflowBuilder.agentInspector.toolsAutomationTitle": "Outils supplémentaires",
  "workflowBuilder.agentInspector.toolsAutomationDescription":
    "Activez les outils optionnels que l'agent peut appeler en cas de besoin.",
  "workflowBuilder.agentInspector.weatherToolLabel": "Outil météo",
  "workflowBuilder.agentInspector.weatherToolHelp":
    "Permet à l'agent de récupérer des informations météo en temps réel.",
  "workflowBuilder.agentInspector.widgetValidationLabel": "Outil de validation de widget",
  "workflowBuilder.agentInspector.widgetValidationHelp":
    "Valide le JSON du widget par rapport au schéma avant de l'envoyer à l'interface.",
  "workflowBuilder.agentInspector.workflowValidationLabel": "Outil de validation de workflow",
  "workflowBuilder.agentInspector.workflowValidationHelp":
    "Vérifie les sorties du workflow avant qu'elles ne soient renvoyées à l'utilisateur.",
  "workflowBuilder.agentInspector.widgetDefinitionLoading": "Chargement de la définition du widget…",
  "workflowBuilder.agentInspector.widgetDefinitionNoBindings":
    "Ce widget n'expose aucun binding dynamique.",
  "workflowBuilder.agentInspector.widgetDefinitionPlaceholder": "Valeur pour {{field}}",
  "workflowBuilder.agentInspector.widgetDefinitionTitle": "Structure JSON attendue",
  "workflowBuilder.agentInspector.widgetDefinitionHide": "Masquer l'exemple JSON",
  "workflowBuilder.agentInspector.widgetDefinitionShow": "Afficher l'exemple JSON",
  "workflowBuilder.agentInspector.widgetDefinitionDescription":
    "Renseignez les clés suivantes lorsque le widget est renvoyé par l'agent.",
  "workflowBuilder.agentInspector.widgetDefinitionBindingsLabel": "Bindings dynamiques",
  "workflowBuilder.agentInspector.widgetLibraryLabel": "Widget",
  "workflowBuilder.agentInspector.widgetLibraryLoading": "Chargement de la bibliothèque de widgets…",
  "workflowBuilder.agentInspector.widgetLibraryPlaceholder": "Sélectionnez un widget",
  "workflowBuilder.agentInspector.widgetLibraryEmpty":
    "Aucun widget n'est encore disponible dans la bibliothèque.",
  "workflowBuilder.agentInspector.widgetExpressionLabel": "Expression JSON du widget",
  "workflowBuilder.agentInspector.widgetExpressionHint":
    "Fournissez une expression qui retourne le JSON du widget (par exemple state.widget_json).",
  "workflowBuilder.agentInspector.widgetExpressionPlaceholder": "ex. state.widget_json",
  "workflowBuilder.agentInspector.widgetValidation.libraryEmpty":
    "Aucun widget n'est disponible dans la bibliothèque.",
  "workflowBuilder.agentInspector.widgetValidation.libraryMissing":
    "Sélectionnez un widget pour activer la sortie.",
  "workflowBuilder.agentInspector.widgetValidation.libraryUnavailable":
    "Le widget sélectionné n'est plus disponible.",
  "workflowBuilder.agentInspector.widgetValidation.variableMissing":
    "Saisissez une expression qui retourne le JSON du widget.",
  "workflowBuilder.agentInspector.widgetSourceLabel": "Source du widget",
  "workflowBuilder.agentInspector.widgetSourceHint":
    "Choisissez entre un widget de la bibliothèque ou une expression JSON fournie par le workflow.",
  "workflowBuilder.agentInspector.widgetSource.library": "Widget de la bibliothèque",
  "workflowBuilder.agentInspector.widgetSource.variable": "Expression du workflow",
  "workflowBuilder.agentInspector.responseFormatLabel": "Format de réponse",
  "workflowBuilder.agentInspector.responseFormat.text": "Texte libre",
  "workflowBuilder.agentInspector.responseFormat.jsonSchema": "Schéma JSON",
  "workflowBuilder.agentInspector.responseFormat.widget": "Widget en sortie",
  "workflowBuilder.agentInspector.jsonSchemaNameLabel": "Nom du schéma",
  "workflowBuilder.agentInspector.jsonSchemaNameHint": "Nom optionnel utilisé pour la documentation.",
  "workflowBuilder.agentInspector.jsonSchemaDefinitionLabel": "Définition du schéma JSON",
  "workflowBuilder.agentInspector.jsonSchemaDefinitionHint":
    "Fournissez un schéma JSON valide (Draft 2020-12).",
  "workflowBuilder.agentInspector.jsonSchemaInvalid": "Schéma JSON invalide",
  "workflowBuilder.agentInspector.behaviorTitle": "Comportement de l'agent",
  "workflowBuilder.agentInspector.behaviorDescription":
    "Contrôlez la manière dont l'agent interagit avec les utilisateurs et gère les erreurs.",
  "workflowBuilder.agentInspector.includeChatHistoryLabel": "Inclure l'historique de conversation",
  "workflowBuilder.agentInspector.includeChatHistoryHelp":
    "Envoie les messages précédents à l'agent comme contexte.",
  "workflowBuilder.agentInspector.displayResponseInChatLabel": "Afficher la réponse dans le chat",
  "workflowBuilder.agentInspector.displayResponseInChatHelp":
    "Affiche la sortie de l'agent dans la conversation.",
  "workflowBuilder.agentInspector.showSearchSourcesLabel": "Afficher les sources de recherche",
  "workflowBuilder.agentInspector.showSearchSourcesHelp":
    "Ajoute la liste des sources de recherche à la réponse finale.",
  "workflowBuilder.agentInspector.continueOnErrorLabel": "Continuer en cas d'erreur",
  "workflowBuilder.agentInspector.continueOnErrorHelp":
    "Continue l'exécution du workflow même si cet agent échoue.",
  "workflowBuilder.agentInspector.storeResponsesLabel": "Enregistrer les réponses",
  "workflowBuilder.agentInspector.storeResponsesHelp":
    "Conserve les réponses de l'agent pour référence ultérieure.",
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
  "workflows.pinAction": "Épingler",
  "workflows.unpinAction": "Retirer l'épinglage",
  "workflows.pinnedSectionTitle": "Workflows épinglés",
  "workflows.defaultSectionTitle": "Workflows",
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
  "workflowBuilder.hostedSection.customizeAction": "Personnaliser",
  "workflowBuilder.hostedSection.deleteAction": "Supprimer",
  "workflowBuilder.hostedSection.openActions": "Actions pour {label}",
  "workflowBuilder.hostedSection.deleting": "Suppression du workflow hébergé…",
  "workflowBuilder.hostedSection.deleteSuccess":
    "Workflow hébergé \"{label}\" supprimé.",
  "workflowBuilder.hostedSection.deleteError":
    "Impossible de supprimer le workflow hébergé.",
  "workflowBuilder.hostedSection.loadError":
    "Impossible de charger les workflows hébergés.",
  "workflowBuilder.hostedSection.confirmDelete":
    "Supprimer le workflow hébergé \"{label}\" ? Cette action est irréversible.",
  "workflowAppearance.modal.title":
    "Personnaliser l'apparence de \"{label}\"",
  "workflowAppearance.modal.defaultTitle": "Personnaliser l'apparence",
  "workflowAppearance.modal.inherited":
    "\"{label}\" utilise actuellement l'apparence globale.",
  "workflowAppearance.modal.customized":
    "\"{label}\" utilise une apparence personnalisée.",
  "workflowAppearance.actions.save": "Enregistrer",
  "workflowAppearance.actions.cancel": "Annuler",
  "workflowAppearance.actions.reset": "Revenir aux paramètres globaux",
  "workflowAppearance.feedback.saved":
    "Apparence du workflow mise à jour.",
  "workflowAppearance.feedback.reset":
    "Apparence du workflow réinitialisée sur les paramètres globaux.",
  "workflowAppearance.errors.missingReference":
    "Impossible de déterminer le workflow à personnaliser.",
  "workflowAppearance.errors.loadFailed":
    "Impossible de charger l'apparence du workflow.",
  "workflowAppearance.errors.saveFailed":
    "Impossible d'enregistrer l'apparence du workflow.",
  "workflowAppearance.errors.resetFailed":
    "Impossible de réinitialiser l'apparence du workflow.",
  "workflowBuilder.save.autoSaveSuccess": "Modifications enregistrées automatiquement.",
  "workflowBuilder.save.draftDisplayName": "Brouillon",
  "workflowBuilder.save.failure": "Impossible d'enregistrer le workflow.",
  "workflowBuilder.save.failureWithStatus": "Échec de l'enregistrement ({{status}}).",
  "workflowBuilder.save.errorReadResponse":
    "Impossible de lire la réponse d'erreur de sauvegarde.",
  "workflowBuilder.save.errorWorkflowRequired":
    "Sélectionnez un workflow avant d'enregistrer une version.",
  "workflowBuilder.save.errorInvalidParameters":
    "Corrigez les paramètres JSON invalides avant d'enregistrer.",
  "workflowBuilder.publicationReminder.publishToUse":
    "Publiez une version pour l'utiliser.",
  "workflowBuilder.errors.unknown": "Erreur inconnue.",
  "workflowBuilder.errors.loadVersionFailedWithStatus":
    "Échec du chargement de la version ({{status}}).",
  "workflowBuilder.errors.loadVersionsFailedWithStatus":
    "Échec du chargement des versions ({{status}}).",
  "workflowBuilder.errors.loadLibraryFailedWithStatus":
    "Échec du chargement de la bibliothèque ({{status}}).",
  "workflowBuilder.errors.refreshVersionsFailedWithStatus":
    "Échec du rafraîchissement des versions ({{status}}).",
  "workflowBuilder.localSection.customizeAction": "Personnaliser",
  "workflowBuilder.localSection.openActions": "Actions pour {label}",
  "workflowBuilder.localSection.duplicateAction": "Dupliquer",
  "workflowBuilder.localSection.renameAction": "Renommer",
  "workflowBuilder.localSection.exportAction": "Exporter en JSON",
  "workflowBuilder.localSection.deleteAction": "Supprimer",
  "workflowBuilder.localSection.missingProduction": "Aucune version en production",
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
  "workflowBuilder.endInspector.messageLabel": "Message de fin",
  "workflowBuilder.endInspector.messageHelp":
    "Affiché aux utilisateurs et enregistré comme raison de clôture lorsque ce bloc termine le workflow.",
  "workflowBuilder.endInspector.messagePlaceholder":
    "Texte affiché lorsque le workflow se termine sur ce bloc",
  "workflowBuilder.endInspector.agsSectionAriaLabel": "Publication de notes LTI",
  "workflowBuilder.endInspector.agsSectionTitle": "Publication LTI (AGS)",
  "workflowBuilder.endInspector.agsSectionHint":
    "Associez des variables du workflow pour envoyer une note via le service LTI Assignment and Grade Services. Laissez un champ vide pour ne pas le transmettre.",
  "workflowBuilder.endInspector.agsVariableLabel": "Identifiant de la ligne de note",
  "workflowBuilder.endInspector.agsVariableHelp":
    "Saisissez l'identifiant configuré côté plateforme LTI.",
  "workflowBuilder.endInspector.agsVariablePlaceholder": "Ex. quiz-final",
  "workflowBuilder.endInspector.agsScoreLabel": "Expression de la note",
  "workflowBuilder.endInspector.agsScoreHelp":
    "Utilisez une expression du workflow (ex. state.grade.score) ou un nombre.",
  "workflowBuilder.endInspector.agsScorePlaceholder": "Ex. state.grade.score",
  "workflowBuilder.endInspector.agsMaximumLabel": "Expression du maximum",
  "workflowBuilder.endInspector.agsMaximumHelp":
    "Référencez une variable ou saisissez la valeur maximale de la note.",
  "workflowBuilder.endInspector.agsMaximumPlaceholder": "Ex. 20 ou state.grade.maximum",
  "workflowBuilder.node.kind.start": "Début",
  "workflowBuilder.node.kind.agent": "Agent",
  "workflowBuilder.node.kind.voice_agent": "Agent vocal",
  "workflowBuilder.node.kind.outbound_call": "Appel sortant",
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
  "workflowBuilder.node.kind.while": "Boucle while",
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
  "workflowBuilder.while.conditionLabel": "Condition de boucle",
  "workflowBuilder.while.conditionHelp": "Expression évaluée à chaque itération. La boucle continue tant que cette expression est vraie.",
  "workflowBuilder.while.conditionPlaceholder": "Ex. state.compteur < 10",
  "workflowBuilder.while.maxIterationsLabel": "Nombre maximum d'itérations",
  "workflowBuilder.while.maxIterationsHelp": "Limite de sécurité pour éviter les boucles infinies.",
  "workflowBuilder.while.maxIterationsPlaceholder": "Ex. 100",
  "workflowBuilder.while.iterationVarLabel": "Variable d'itération (optionnel)",
  "workflowBuilder.while.iterationVarHelp": "Variable pour stocker le compteur d'itération (commence à 0).",
  "workflowBuilder.while.iterationVarPlaceholder": "Ex. index_boucle",
  "admin.mcpServers.page.title": "Serveurs MCP",
  "admin.mcpServers.page.subtitle":
    "Déclarez et sécurisez les serveurs MCP utilisés par ChatKit.",
  "admin.mcpServers.actions.startCreate": "Ajouter un serveur",
  "admin.mcpServers.list.title": "Serveurs configurés",
  "admin.mcpServers.list.subtitle":
    "Contrôlez les connexions et le cache des outils exposés par les serveurs MCP.",
  "admin.mcpServers.list.loading": "Chargement des serveurs MCP…",
  "admin.mcpServers.list.empty": "Aucun serveur MCP n'est enregistré pour le moment.",
  "admin.mcpServers.list.columns.label": "Libellé",
  "admin.mcpServers.list.columns.url": "URL du serveur",
  "admin.mcpServers.list.columns.tools": "Outils mis en cache",
  "admin.mcpServers.list.columns.updated": "Cache actualisé",
  "admin.mcpServers.list.columns.status": "Statut",
  "admin.mcpServers.list.columns.actions": "Actions",
  "admin.mcpServers.list.authorizationHint": "Jeton stocké : {{hint}}",
  "admin.mcpServers.list.toolsWithNames": "{{count}} outil(s) : {{tools}}",
  "admin.mcpServers.list.toolsEmpty": "Aucun outil mis en cache",
  "admin.mcpServers.list.neverRefreshed": "Jamais actualisé",
  "admin.mcpServers.list.status.active": "Actif",
  "admin.mcpServers.list.status.inactive": "Inactif",
  "admin.mcpServers.actions.edit": "Modifier",
  "admin.mcpServers.actions.refreshTools": "Rafraîchir les outils",
  "admin.mcpServers.actions.refreshing": "Actualisation…",
  "admin.mcpServers.actions.delete": "Supprimer",
  "admin.mcpServers.actions.deleting": "Suppression…",
  "admin.mcpServers.confirm.delete": "Supprimer le serveur « {{label}} » ?",
  "admin.mcpServers.form.createTitle": "Ajouter un serveur MCP",
  "admin.mcpServers.form.editTitle": "Modifier « {{label}} »",
  "admin.mcpServers.form.createSubtitle":
    "Renseignez l'URL du serveur et les informations d'authentification nécessaires.",
  "admin.mcpServers.form.editSubtitle":
    "Mettez à jour les informations ou rafraîchissez le cache des outils.",
  "admin.mcpServers.form.labelLabel": "Libellé*",
  "admin.mcpServers.form.labelPlaceholder": "Serveur partenaire",
  "admin.mcpServers.form.serverUrlLabel": "URL du serveur MCP*",
  "admin.mcpServers.form.serverUrlPlaceholder": "https://mcp.example.com/",
  "admin.mcpServers.form.authorizationLabel": "En-tête Authorization",
  "admin.mcpServers.form.authorizationPlaceholder": "Bearer …",
  "admin.mcpServers.form.authorizationHint":
    "En-tête actuel : {{hint}} (laisser vide pour conserver)",
  "admin.mcpServers.form.accessTokenLabel": "Jeton d'accès",
  "admin.mcpServers.form.accessTokenPlaceholder": "Nouveau jeton d'accès",
  "admin.mcpServers.form.accessTokenHint":
    "Jeton enregistré : {{hint}} (laisser vide pour conserver)",
  "admin.mcpServers.form.refreshTokenLabel": "Refresh token",
  "admin.mcpServers.form.refreshTokenPlaceholder": "Nouveau refresh token",
  "admin.mcpServers.form.refreshTokenHint":
    "Refresh token enregistré : {{hint}} (laisser vide pour conserver)",
  "admin.mcpServers.form.oauthClientIdLabel": "Client ID OAuth",
  "admin.mcpServers.form.oauthClientIdPlaceholder": "Identifiant client",
  "admin.mcpServers.form.oauthClientSecretLabel": "Client secret OAuth",
  "admin.mcpServers.form.oauthClientSecretPlaceholder": "Nouveau client secret",
  "admin.mcpServers.form.oauthClientSecretHint":
    "Secret enregistré : {{hint}} (laisser vide pour conserver)",
  "admin.mcpServers.form.oauthScopeLabel": "Scopes OAuth",
  "admin.mcpServers.form.oauthScopePlaceholder": "scope1 scope2",
  "admin.mcpServers.form.oauthAuthorizationEndpointLabel":
    "Endpoint d'autorisation",
  "admin.mcpServers.form.oauthAuthorizationEndpointPlaceholder":
    "https://auth.example.com/authorize",
  "admin.mcpServers.form.oauthTokenEndpointLabel": "Endpoint de jeton",
  "admin.mcpServers.form.oauthTokenEndpointPlaceholder":
    "https://auth.example.com/token",
  "admin.mcpServers.form.oauthRedirectUriLabel": "Redirect URI",
  "admin.mcpServers.form.oauthRedirectUriPlaceholder":
    "URL de redirection personnalisée",
  "admin.mcpServers.form.oauthMetadataLabel": "Métadonnées OAuth (JSON)",
  "admin.mcpServers.form.oauthMetadataPlaceholder": "{ \"aud\": \"…\" }",
  "admin.mcpServers.form.oauthMetadataHint":
    "Le contenu est stocké tel quel pour référence et peut être laissé vide.",
  "admin.mcpServers.form.isActiveLabel": "Activer ce serveur",
  "admin.mcpServers.form.saving": "Enregistrement…",
  "admin.mcpServers.form.createSubmit": "Créer le serveur",
  "admin.mcpServers.form.updateSubmit": "Enregistrer les modifications",
  "admin.mcpServers.form.cancel": "Annuler",
  "admin.mcpServers.form.cancelEdit": "Annuler la modification",
  "admin.mcpServers.form.oauthButton": "Lancer OAuth",
  "admin.mcpServers.form.testButton": "Tester la connexion",
  "admin.mcpServers.test.running": "Test en cours…",
  "admin.mcpServers.test.successWithTools":
    "Connexion établie ({{count}} outil(s) : {{tools}}).",
  "admin.mcpServers.test.success": "Connexion établie avec succès.",
  "admin.mcpServers.test.errorGeneric": "Le test de connexion a échoué.",
  "admin.mcpServers.oauth.starting": "Initialisation du flux OAuth…",
  "admin.mcpServers.oauth.pending": "Flux OAuth en attente de validation…",
  "admin.mcpServers.oauth.success": "Jeton OAuth enregistré.",
  "admin.mcpServers.oauth.errorGeneric": "Échec du flux OAuth.",
  "admin.mcpServers.oauth.errorWithDetail": "Échec du flux OAuth : {{detail}}",
  "admin.mcpServers.oauth.errorMissingDraft":
    "Impossible d'enregistrer le serveur OAuth : brouillon incomplet.",
  "admin.mcpServers.feedback.created": "Serveur « {{label}} » créé.",
  "admin.mcpServers.feedback.updated": "Serveur « {{label}} » mis à jour.",
  "admin.mcpServers.feedback.deleted": "Serveur « {{label}} » supprimé.",
  "admin.mcpServers.feedback.toolsRefreshed":
    "Cache d'outils rafraîchi pour « {{label}} ».",
  "admin.mcpServers.feedback.oauthSuccess":
    "Les identifiants OAuth ont été synchronisés.",
  "admin.mcpServers.errors.sessionExpired":
    "Session expirée, veuillez vous reconnecter.",
  "admin.mcpServers.errors.loadFailed":
    "Impossible de charger les serveurs MCP.",
  "admin.mcpServers.errors.deleteFailed":
    "Impossible de supprimer le serveur.",
  "admin.mcpServers.errors.refreshFailed":
    "Impossible d'actualiser le cache d'outils.",
  "admin.mcpServers.errors.saveFailed":
    "Impossible d'enregistrer le serveur.",
  "admin.mcpServers.errors.labelRequired":
    "Indiquez un libellé pour ce serveur.",
  "admin.mcpServers.errors.serverUrlRequired":
    "Indiquez l'URL du serveur MCP.",
  "admin.mcpServers.errors.invalidMetadata":
    "Les métadonnées doivent être un objet JSON valide.",
  "admin.mcpServers.errors.testFailed":
    "Impossible de tester la connexion MCP.",
  "admin.languages.page.title": "Gestion des langues",
  "admin.languages.page.subtitle":
    "Configurez les langues disponibles dans l'interface et automatisez leur traduction.",
  "admin.languages.list.title": "Langues disponibles",
  "admin.languages.list.subtitle":
    "Gérez les langues de l'interface et leurs traductions.",
  "admin.languages.list.loading": "Chargement des langues…",
  "admin.languages.list.columns.code": "Code",
  "admin.languages.list.columns.name": "Nom",
  "admin.languages.list.columns.translationFile": "Fichier de traductions",
  "admin.languages.list.columns.keysCount": "Nombre de clés",
  "admin.languages.list.columns.status": "Statut",
  "admin.languages.list.columns.actions": "Actions",
  "admin.languages.list.status.complete": "Complet",
  "admin.languages.list.status.partial": "Partiel ({{percent}}%)",
  "admin.languages.list.status.empty": "Vide",
  "admin.languages.list.fileExists": "✓ Fichier existant",
  "admin.languages.list.fileMissing": "✗ Fichier manquant",
  "admin.languages.form.addTitle": "Ajouter une langue",
  "admin.languages.form.codeLabel": "Code de langue*",
  "admin.languages.form.codePlaceholder": "ex. es, de, it",
  "admin.languages.form.codeHint":
    "Code ISO 639-1 à deux lettres (ex: es pour espagnol, de pour allemand).",
  "admin.languages.form.nameLabel": "Nom de la langue*",
  "admin.languages.form.namePlaceholder": "ex. Español, Deutsch",
  "admin.languages.form.nameHint":
    "Nom de la langue dans sa propre langue (forme native).",
  "admin.languages.form.submitAdd": "Ajouter la langue",
  "admin.languages.form.cancel": "Annuler",
  "admin.languages.form.creating": "Création…",
  "admin.languages.form.modelLabel": "Modèle",
  "admin.languages.form.modelPlaceholder": "Utiliser le modèle par défaut",
  "admin.languages.form.modelHint":
    "Sélectionner un modèle spécifique pour la traduction (optionnel).",
  "admin.languages.form.providerLabel": "Provider",
  "admin.languages.form.providerPlaceholder": "Utiliser le provider par défaut",
  "admin.languages.form.providerHint":
    "Sélectionner le provider à utiliser pour la traduction (optionnel).",
  "admin.languages.form.promptLabel": "Prompt de traduction",
  "admin.languages.form.showPrompt": "Personnaliser le prompt",
  "admin.languages.form.hidePrompt": "Masquer le prompt",
  "admin.languages.form.promptPlaceholder": "Entrer un prompt personnalisé...",
  "admin.languages.form.promptHint":
    "Variables disponibles: {{language_name}}, {{language_code}}, {{translations_json}}",
  "admin.languages.actions.autoTranslate": "Traduire automatiquement",
  "admin.languages.actions.translating": "Traduction en cours…",
  "admin.languages.actions.delete": "Supprimer",
  "admin.languages.actions.deleting": "Suppression…",
  "admin.languages.actions.download": "Télécharger le fichier",
  "admin.languages.confirm.delete":
    "Supprimer la langue « {{name}} » ({{code}}) ? Cette action supprimera le fichier de traductions correspondant.",
  "admin.languages.confirm.autoTranslate":
    "Lancer la traduction automatique pour « {{name}} » ? Cela peut prendre quelques minutes et remplacera les traductions existantes.",
  "admin.languages.feedback.created":
    "Langue « {{name}} » ajoutée avec succès.",
  "admin.languages.feedback.deleted":
    "Langue « {{name}} » supprimée avec succès.",
  "admin.languages.feedback.translationStarted":
    "Traduction automatique lancée pour « {{name}} ».",
  "admin.languages.feedback.translationComplete":
    "Traduction automatique terminée. {{count}} clés traduites.",
  "admin.languages.feedback.translationProgress":
    "Traduction en cours… {{current}}/{{total}} clés traduites.",
  "admin.languages.errors.loadFailed":
    "Impossible de charger les langues.",
  "admin.languages.errors.createFailed":
    "Impossible d'ajouter la langue.",
  "admin.languages.errors.deleteFailed":
    "Impossible de supprimer la langue.",
  "admin.languages.errors.translationFailed":
    "Impossible de traduire automatiquement la langue.",
  "admin.languages.errors.codeRequired":
    "Le code de langue est obligatoire.",
  "admin.languages.errors.nameRequired":
    "Le nom de la langue est obligatoire.",
  "admin.languages.errors.codeInvalid":
    "Le code doit être composé de 2 lettres minuscules (ISO 639-1).",
  "admin.languages.errors.codeExists":
    "Cette langue existe déjà.",
  "admin.languages.errors.cannotDeleteBase":
    "Impossible de supprimer les langues de base (en, fr).",
  "admin.languages.errors.sessionExpired":
    "Session expirée, veuillez vous reconnecter.",
  "workflowBuilder.widgetInspector.media.previewAlt": "Prévisualisation pour {{identifier}}",
  "workflowBuilder.widgetInspector.media.selectedImage": "Image sélectionnée",
  "workflowBuilder.widgetInspector.media.previewUpdated":
    "Aperçu mis à jour pour la prévisualisation du widget.",
  "workflowBuilder.widgetInspector.media.noFile": "Aucun fichier sélectionné",
  "workflowBuilder.widgetInspector.media.hint":
    "Importez une image ou saisissez une URL/expression existante. En l'absence de fichier, le texte est utilisé tel quel.",
  "chatkit.thread.newConversation": "Nouvelle conversation",
  "chatkit.thread.conversation": "Conversation",
  "chatkit.message.copy": "Copier",
  "chatkit.message.copied": "Copié",
  "chatkit.code.copy": "Copier le code",
  "chatkit.code.copied": "Copié",
  "chatkit.workflow.expand": "Développer",
  "chatkit.workflow.collapse": "Réduire",
  "chatkit.workflow.reasoning": "Raisonnement",
  "chatkit.workflow.workflow": "Workflow",
  "chatkit.workflow.executionDuration": "Exécution durant {{duration}}",
  "chatkit.workflow.loading": "En cours...",
  "chatkit.task.imageCompleted": "Génération d'image complétée",
};
  

/**
 * Monkey-patch pour forcer tous les shadow DOM à être en mode "open"
 * ⚠️ À utiliser UNIQUEMENT en développement pour déboguer les web components
 *
 * Ce script permet d'inspecter le contenu des shadow DOM (comme ChatKit)
 * qui sont normalement en mode "closed" dans les DevTools.
 */
(function () {
  const origAttachShadow = Element.prototype.attachShadow;

  Element.prototype.attachShadow = function (init) {
    // On force toujours mode: "open"
    const shadow = origAttachShadow.call(this, { ...init, mode: 'open' });

    // Log optionnel pour voir quels éléments utilisent un shadow DOM
    if (import.meta.env.DEV) {
      console.log('[open-shadow] Shadow DOM ouvert pour:', this.tagName);
    }

    return shadow;
  };
})();

import { describe, expect, it, vi, beforeEach } from "vitest";

import { COMPOSER_MODELS_STORAGE_KEY, loadComposerModelsConfig } from "../composerModels";

describe("loadComposerModelsConfig", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns null when no config is stored", () => {
    expect(loadComposerModelsConfig()).toBeNull();
  });

  it("parses a plain array configuration", () => {
    const models = [
      { id: "gpt-4.1", label: "gpt-4.1", description: "Default" },
      { id: "o1-mini", label: "o1-mini" },
    ];
    window.localStorage.setItem(COMPOSER_MODELS_STORAGE_KEY, JSON.stringify(models));

    expect(loadComposerModelsConfig()).toEqual(models);
  });

  it("parses an enabled object wrapper and ignores disabled ones", () => {
    const enabledConfig = { enabled: true, options: [{ id: "gpt-4.1", label: "gpt-4.1" }] };
    window.localStorage.setItem(COMPOSER_MODELS_STORAGE_KEY, JSON.stringify(enabledConfig));

    expect(loadComposerModelsConfig()).toEqual(enabledConfig.options);

    window.localStorage.setItem(
      COMPOSER_MODELS_STORAGE_KEY,
      JSON.stringify({ ...enabledConfig, enabled: false }),
    );
    expect(loadComposerModelsConfig()).toBeNull();
  });

  it("warns and returns null on invalid JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.setItem(COMPOSER_MODELS_STORAGE_KEY, "{invalid JSON}");

    expect(loadComposerModelsConfig()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

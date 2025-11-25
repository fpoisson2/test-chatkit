import type {
  ComputerUseConfig,
  ImageGenerationToolConfig,
  VoiceAgentTool,
  WebSearchConfig,
} from "../../types";

export const reasoningEffortOptions = [
  { value: "", label: "Comportement par défaut" },
  { value: "low", label: "Effort minimal" },
  { value: "medium", label: "Effort moyen" },
  { value: "high", label: "Effort élevé" },
] as const;

export const reasoningSummaryOptions = [
  { value: "none", label: "Pas de résumé" },
  { value: "auto", label: "Résumé automatique" },
  { value: "detailed", label: "Résumé détaillé" },
] as const;

export const textVerbosityOptions = [
  { value: "", label: "Comportement par défaut" },
  { value: "low", label: "Verbosité faible" },
  { value: "medium", label: "Verbosité moyenne" },
  { value: "high", label: "Verbosité élevée" },
] as const;

export const conditionModeOptions = [
  {
    value: "truthy",
    label: "Comparer la valeur en tant que booléen (branches true/false)",
  },
  {
    value: "falsy",
    label: "Branche true si la valeur est vide ou fausse",
  },
  {
    value: "equals",
    label: "Branche true si la valeur est égale à la valeur ci-dessous",
  },
  {
    value: "not_equals",
    label: "Branche true si la valeur est différente de la valeur ci-dessous",
  },
  {
    value: "value",
    label: "Utiliser directement la valeur observée (plusieurs branches)",
  },
] as const;

export const DEFAULT_JSON_SCHEMA_OBJECT = { type: "object", properties: {} } as const;
export const DEFAULT_JSON_SCHEMA_TEXT = JSON.stringify(DEFAULT_JSON_SCHEMA_OBJECT, null, 2);
export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = { search_context_size: "medium" };

export const DEFAULT_IMAGE_TOOL_CONFIG: ImageGenerationToolConfig = {
  model: "gpt-image-1-mini",
  size: "1024x1024",
  quality: "high",
  background: "auto",
  output_format: "auto",
  partial_images: 3,
};

export const DEFAULT_COMPUTER_USE_CONFIG: ComputerUseConfig = {
  display_width: 1024,
  display_height: 768,
  environment: "browser",
};

export const COMPUTER_USE_ENVIRONMENTS = [
  "browser",
  "mac",
  "windows",
  "ubuntu",
  "ssh",
  "vnc",
] as const;

export const WEB_SEARCH_LOCATION_LABELS = {
  city: "Ville",
  region: "Région",
  country: "Pays",
  type: "Type de précision",
} as const;

export const IMAGE_TOOL_MODELS = [
  { value: "gpt-image-1-mini", label: "gpt-image-1-mini" },
  { value: "gpt-image-1", label: "gpt-image-1" },
] as const;

export const IMAGE_TOOL_SIZES = [
  { value: "1024x1024", label: "1024 × 1024" },
  { value: "1024x1536", label: "1024 × 1536" },
  { value: "1536x1024", label: "1536 × 1024" },
  { value: "auto", label: "Automatique" },
] as const;

export const IMAGE_TOOL_QUALITIES = [
  { value: "high", label: "Haute" },
  { value: "medium", label: "Moyenne" },
  { value: "low", label: "Basse" },
  { value: "auto", label: "Automatique" },
] as const;

export const IMAGE_TOOL_BACKGROUNDS = [
  { value: "auto", label: "Automatique" },
  { value: "transparent", label: "Transparent" },
  { value: "opaque", label: "Opaque" },
] as const;

export const IMAGE_TOOL_OUTPUT_FORMATS = [
  { value: "auto", label: "Automatique" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
  { value: "jpeg", label: "JPEG" },
] as const;

export const isTestEnvironment =
  typeof process !== "undefined" && process.env && process.env.NODE_ENV === "test";

export const EMPTY_TRANSFORM_EXPRESSIONS: Record<string, unknown> = Object.freeze({});

export const VOICE_AGENT_START_BEHAVIOR_OPTIONS = [
  {
    value: "manual" as const,
    labelKey: "workflowBuilder.voiceInspector.start.manual",
  },
  {
    value: "auto" as const,
    labelKey: "workflowBuilder.voiceInspector.start.auto",
  },
] as const;

export const VOICE_AGENT_STOP_BEHAVIOR_OPTIONS = [
  {
    value: "manual" as const,
    labelKey: "workflowBuilder.voiceInspector.stop.manual",
  },
  {
    value: "auto" as const,
    labelKey: "workflowBuilder.voiceInspector.stop.auto",
  },
] as const;

export const VOICE_AGENT_TOOL_DEFINITIONS: ReadonlyArray<{
  key: VoiceAgentTool;
  labelKey: string;
  helpKey?: string;
}> = [
  {
    key: "response",
    labelKey: "workflowBuilder.voiceInspector.tool.response",
  },
  {
    key: "transcription",
    labelKey: "workflowBuilder.voiceInspector.tool.transcription",
  },
  {
    key: "function_call",
    labelKey: "workflowBuilder.voiceInspector.tool.functionCall",
    helpKey: "workflowBuilder.voiceInspector.tool.functionCall.help",
  },
];

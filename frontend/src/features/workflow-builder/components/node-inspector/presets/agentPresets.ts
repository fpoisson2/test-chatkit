import { Headphones, Search, Sliders, Bot, Phone, FileText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AgentPresetConfig {
  // Basic settings
  display_name?: string;
  message?: string;

  // Model settings
  model?: string;
  provider_id?: string | null;
  provider_slug?: string | null;
  temperature?: number;
  max_output_tokens?: number;
  top_p?: number;

  // Tools
  web_search_enabled?: boolean;
  web_search_max_results?: number;
  file_search_enabled?: boolean;
  computer_use_enabled?: boolean;
  image_generation_enabled?: boolean;
  weather_enabled?: boolean;
  widget_validation_enabled?: boolean;
  workflow_validation_enabled?: boolean;

  // Response format
  response_format_kind?: 'text' | 'json_schema' | 'widget';

  // Behavior
  include_chat_history?: boolean;
  display_response_in_chat?: boolean;
  show_search_sources?: boolean;
  continue_on_error?: boolean;
  store_responses?: boolean;
}

export interface AgentPreset {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: 'beginner' | 'common' | 'advanced';
  config: AgentPresetConfig;
}

export const agentPresets: AgentPreset[] = [
  {
    id: 'customer-support',
    name: 'Support Client',
    description: 'Agent optimisé pour répondre aux questions fréquentes et assister les clients',
    icon: Headphones,
    category: 'common',
    config: {
      display_name: 'Agent Support Client',
      message: 'Tu es un assistant de support client professionnel et empathique. Réponds de manière claire, concise et utile aux questions des clients.',
      model: 'claude-3-5-sonnet-20241022',
      provider_slug: 'anthropic',
      temperature: 0.7,
      max_output_tokens: 2048,
      top_p: 1,
      web_search_enabled: false,
      file_search_enabled: false,
      computer_use_enabled: false,
      image_generation_enabled: false,
      response_format_kind: 'text',
      include_chat_history: true,
      display_response_in_chat: true,
      show_search_sources: false,
      continue_on_error: false,
      store_responses: true,
    }
  },
  {
    id: 'research-assistant',
    name: 'Assistant Recherche',
    description: 'Agent avec recherche web pour trouver et synthétiser des informations',
    icon: Search,
    category: 'common',
    config: {
      display_name: 'Assistant Recherche',
      message: 'Tu es un assistant de recherche expert. Utilise la recherche web pour trouver des informations précises et à jour, et fournis des réponses bien documentées avec des sources.',
      model: 'claude-3-5-sonnet-20241022',
      provider_slug: 'anthropic',
      temperature: 0.5,
      max_output_tokens: 4096,
      top_p: 1,
      web_search_enabled: true,
      web_search_max_results: 5,
      file_search_enabled: false,
      computer_use_enabled: false,
      image_generation_enabled: false,
      response_format_kind: 'text',
      include_chat_history: true,
      display_response_in_chat: true,
      show_search_sources: true,
      continue_on_error: false,
      store_responses: true,
    }
  },
  {
    id: 'data-analyst',
    name: 'Analyste de Données',
    description: 'Agent pour analyser des données et produire des rapports structurés',
    icon: FileText,
    category: 'common',
    config: {
      display_name: 'Analyste de Données',
      message: 'Tu es un analyste de données expert. Examine les données fournies, identifie les patterns et insights clés, et produis des analyses claires et actionnables.',
      model: 'claude-3-5-sonnet-20241022',
      provider_slug: 'anthropic',
      temperature: 0.3,
      max_output_tokens: 4096,
      top_p: 1,
      web_search_enabled: false,
      file_search_enabled: true,
      computer_use_enabled: false,
      image_generation_enabled: false,
      response_format_kind: 'json_schema',
      include_chat_history: false,
      display_response_in_chat: true,
      show_search_sources: false,
      continue_on_error: false,
      store_responses: true,
    }
  },
  {
    id: 'voice-agent',
    name: 'Agent Vocal',
    description: 'Agent optimisé pour les interactions vocales',
    icon: Phone,
    category: 'common',
    config: {
      display_name: 'Agent Vocal',
      message: 'Tu es un assistant vocal. Utilise un ton naturel et conversationnel. Sois concis et va droit au but, tout en restant amical.',
      model: 'claude-3-5-sonnet-20241022',
      provider_slug: 'anthropic',
      temperature: 0.8,
      max_output_tokens: 1024,
      top_p: 1,
      web_search_enabled: false,
      file_search_enabled: false,
      computer_use_enabled: false,
      image_generation_enabled: false,
      response_format_kind: 'text',
      include_chat_history: true,
      display_response_in_chat: false,
      show_search_sources: false,
      continue_on_error: true,
      store_responses: true,
    }
  },
  {
    id: 'general-assistant',
    name: 'Assistant Général',
    description: 'Agent polyvalent pour une variété de tâches',
    icon: Bot,
    category: 'beginner',
    config: {
      display_name: 'Assistant Général',
      message: 'Tu es un assistant IA utile et polyvalent. Réponds aux questions de manière claire et précise.',
      model: 'claude-3-5-sonnet-20241022',
      provider_slug: 'anthropic',
      temperature: 0.7,
      max_output_tokens: 2048,
      top_p: 1,
      web_search_enabled: false,
      file_search_enabled: false,
      computer_use_enabled: false,
      image_generation_enabled: false,
      response_format_kind: 'text',
      include_chat_history: true,
      display_response_in_chat: true,
      show_search_sources: false,
      continue_on_error: false,
      store_responses: true,
    }
  },
  {
    id: 'custom',
    name: 'Configuration Personnalisée',
    description: 'Partir d\'une configuration vierge et personnaliser tous les paramètres',
    icon: Sliders,
    category: 'advanced',
    config: {
      // Empty config - user configures everything
    }
  },
];

export const getPresetById = (id: string): AgentPreset | undefined => {
  return agentPresets.find(preset => preset.id === id);
};

export const getPresetsByCategory = (category: AgentPreset['category']): AgentPreset[] => {
  return agentPresets.filter(preset => preset.category === category);
};

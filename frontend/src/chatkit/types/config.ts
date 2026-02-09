/**
 * Types de configuration ChatKit
 */

import type { ReactNode } from 'react';
import type { RadiusValue, WidgetIcon } from './base';
import type {
  Action,
  InferenceOptions,
  FeedbackKind,
  ComposerModel,
} from './actions';
import type {
  VoiceSessionStatus,
  TranscriptEntry,
  OutboundCallStatus,
  OutboundCallTranscript,
} from './voice';
import type { VoiceSessionWidget, OutboundCallWidget } from './widgets';
import type { UserMessageContent } from './messages';
import type { Thread } from './threads';
import type { Branch, CreateBranchResponse } from './branches';

// ===== Configuration API =====

export interface ChatKitAPIConfig {
  url: string;
  headers?: Record<string, string>;
  dangerouslyAllowBrowser?: boolean;
}

// ===== Configuration écran de démarrage =====

export interface StartScreenPrompt {
  label: string;
  prompt: string;
  icon?: WidgetIcon;
}

// ===== Contexte des widgets voix =====

export interface VoiceSessionWidgetContext {
  status: VoiceSessionStatus;
  isListening: boolean;
  transcripts: TranscriptEntry[];
  enabled?: boolean;
  threadId?: string | null;
  startVoiceSession?: () => Promise<void>;
  stopVoiceSession?: () => void;
  interruptSession?: () => void;
  transportError?: string | null;
}

export interface OutboundCallWidgetContext {
  enabled?: boolean;
  callId: string | null;
  isActive: boolean;
  status: OutboundCallStatus;
  toNumber?: string | null;
  transcripts: OutboundCallTranscript[];
  hangupCall?: () => void;
  error?: string | null;
}

// ===== Configuration principale ChatKit =====

export interface ChatKitOptions {
  api: ChatKitAPIConfig;
  initialThread?: string | null;
  /** Optional initial branch id (from URL or state) */
  initialBranchId?: string | null;
  header?: {
    enabled?: boolean;
    leftAction?: {
      icon: string;
      onClick: () => void;
    };
    /** Custom content to render in the header (e.g., workflow selector) */
    customContent?: ReactNode;
  };
  history?: {
    enabled?: boolean;
  };
  theme?: {
    colorScheme?: 'light' | 'dark';
    radius?: RadiusValue;
    density?: 'compact' | 'normal' | 'comfortable';
    color?: {
      accent?: {
        primary?: string;
        level?: number;
      };
      surface?: {
        background?: string;
        foreground?: string;
      };
    };
    typography?: {
      baseSize?: number;
      fontFamily?: string;
      fontFamilyMono?: string;
    };
  };
  startScreen?: {
    greeting?: string;
    prompts?: StartScreenPrompt[];
  };
  disclaimer?: {
    text: string;
  };
  composer?: {
    placeholder?: string;
    attachments?: {
      enabled: boolean;
      maxCount?: number;
      maxSize?: number;
      accept?: Record<string, string[]>;
    };
    models?:
      | {
          enabled: boolean;
          options: ComposerModel[];
        }
      | ComposerModel[];
  };
  widgets?: {
    voiceSession?: VoiceSessionWidgetContext;
    voiceSessionWidget?: Partial<VoiceSessionWidget>;
    outboundCall?: OutboundCallWidgetContext;
    outboundCallWidget?: Partial<OutboundCallWidget>;
  };
  onClientTool?: (toolCall: { name: string; params: unknown }) => Promise<unknown>;
  onError?: (error: { error: Error }) => void;
  onResponseStart?: () => void;
  onResponseEnd?: () => void;
  onThreadChange?: (event: { threadId: string | null }) => void;
  onThreadLoadStart?: (event: { threadId: string }) => void;
  onThreadLoadEnd?: (event: { threadId: string }) => void;
  onThreadNotFound?: (event: { threadId: string }) => void;
  onLog?: (entry: { name: string; data?: Record<string, unknown> }) => void;
  /** Called when active branch changes */
  onBranchChange?: (event: { branchId: string }) => void;
  /** Show usage metadata (cost, tokens) for admin users */
  isAdmin?: boolean;
}

// ===== Control ChatKit =====

export interface ChatKitControl {
  thread: Thread | null;
  isLoading: boolean;
  error: Error | null;
  loadingThreadIds: Set<string>;
  sendMessage: (content: UserMessageContent[] | string, options?: { inferenceOptions?: InferenceOptions }) => Promise<void>;
  resumeStream: (threadId: string) => Promise<void>;
  refresh: () => Promise<void>;
  customAction: (itemId: string | null, action: Action) => Promise<void>;
  retryAfterItem: (itemId: string) => Promise<void>;
  submitFeedback: (itemIds: string[], kind: FeedbackKind) => Promise<void>;
  updateThreadMetadata: (metadata: Record<string, unknown>) => Promise<void>;
  /** Clear any displayed error */
  clearError: () => void;
  /** Whether there are older messages that can be loaded */
  hasMoreItems: boolean;
  /** Whether older items are currently being loaded */
  isLoadingOlderItems: boolean;
  /** Load older messages */
  loadOlderItems: () => Promise<void>;

  // Branch management
  /** List of all branches for the current thread */
  branches: Branch[];
  /** Current active branch ID */
  currentBranchId: string;
  /** Maximum allowed branches (0 = unlimited) */
  maxBranches: number;
  /** Whether a new branch can be created */
  canCreateBranch: boolean;
  /** Whether branches are currently loading */
  isLoadingBranches: boolean;
  /** Create a new branch from a fork point and optionally edit the message */
  createBranch: (forkAfterItemId: string, name?: string) => Promise<CreateBranchResponse | null>;
  /** Switch to a different branch */
  switchBranch: (branchId: string) => Promise<boolean>;
  /** Edit a message by creating a new branch */
  editMessage: (itemId: string, newContent: string, branchName?: string) => Promise<void>;
}

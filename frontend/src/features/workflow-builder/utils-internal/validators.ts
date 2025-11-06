import type { NodeKind } from "../types";
import { NODE_COLORS } from "../utils";

/**
 * Type guards and validators for the workflow builder
 */

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isValidNodeKind = (value: string): value is NodeKind =>
  Object.prototype.hasOwnProperty.call(NODE_COLORS, value);

export type AgentLikeKind = Extract<NodeKind, "agent" | "voice_agent">;

export const isAgentKind = (kind: NodeKind): kind is AgentLikeKind =>
  kind === "agent" || kind === "voice_agent";

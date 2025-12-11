import type { EdgeTypes } from "@xyflow/react";
import SmartEdge from "./SmartEdge";

export const edgeTypes: EdgeTypes = {
  smart: SmartEdge,
} as const;

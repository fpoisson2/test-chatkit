import type { NodeTypes } from "@xyflow/react";
import { WhileNode } from "./WhileNode";

export const nodeTypes: NodeTypes = {
  while: WhileNode,
} as const;

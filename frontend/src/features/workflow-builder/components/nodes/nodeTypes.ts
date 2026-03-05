import type { NodeTypes } from "@xyflow/react";
import { WhileNode } from "./WhileNode";
import { DefaultNode } from "./DefaultNode";

export const nodeTypes: NodeTypes = {
  default: DefaultNode,
  while: WhileNode,
} as const;

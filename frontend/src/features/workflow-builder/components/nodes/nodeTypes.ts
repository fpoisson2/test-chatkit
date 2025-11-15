import type { NodeTypes } from "reactflow";
import { WhileNode } from "./WhileNode";

export const nodeTypes: NodeTypes = {
  while: WhileNode,
} as const;

import type { NodeTypes } from "reactflow";
import { WhileNode } from "./WhileNode";
import type { FlowNodeData } from "../../types";

export const nodeTypes: NodeTypes = {
  while: WhileNode,
} as const;

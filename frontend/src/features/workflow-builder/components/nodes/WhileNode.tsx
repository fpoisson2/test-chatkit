import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { FlowNodeData } from "../../types";
import styles from "./WhileNode.module.css";

export const WhileNode = memo(({ data, selected }: NodeProps<FlowNodeData>) => {
  return (
    <div
      className={styles.whileContainer}
      data-selected={selected}
    >
      <div className={styles.whileHeader}>
        <span className={styles.whileLabel}>⟲ {data.label}</span>
      </div>
      <div className={styles.whileBody}>
        {/* Cette zone contiendra les blocs enfants */}
      </div>
      {/* Handles pour les connexions */}
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
});

WhileNode.displayName = "WhileNode";

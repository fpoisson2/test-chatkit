import { memo } from "react";
import { Handle, Position, NodeResizer, type NodeProps } from "reactflow";
import type { FlowNodeData } from "../../types";
import styles from "./WhileNode.module.css";

export const WhileNode = memo(({ data, selected }: NodeProps<FlowNodeData>) => {
  return (
    <div
      className={styles.whileContainer}
      data-selected={selected}
    >
      <NodeResizer
        color={selected ? "#a855f7" : "#a855f780"}
        isVisible={selected}
        minWidth={300}
        minHeight={200}
        lineStyle={{ borderWidth: 2 }}
        handleStyle={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "#a855f7",
          border: "2px solid white",
        }}
      />
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

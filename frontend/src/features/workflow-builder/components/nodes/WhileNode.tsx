import { memo } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "reactflow";
import type { FlowNodeData } from "../../types";
import { buildNodeStyle } from "../../utils";
import styles from "./WhileNode.module.css";

export const WhileNode = memo(({ data, selected }: NodeProps<FlowNodeData>) => {
  const nodeStyle = buildNodeStyle("while", { isSelected: selected });

  return (
    <>
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
      <div className={styles.whileContainer} style={nodeStyle}>
        <div className={styles.whileHeader}>
          <span className={styles.whileLabel}>⟲ {data.label}</span>
        </div>
        <div className={styles.whileBody}>
          {/* Cette zone contiendra les blocs enfants */}
        </div>
      </div>
      {/* Handles pour les connexions */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
});

WhileNode.displayName = "WhileNode";

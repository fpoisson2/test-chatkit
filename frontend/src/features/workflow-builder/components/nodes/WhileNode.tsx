import { memo } from "react";
import { NodeResizer, type NodeProps } from "reactflow";
import type { FlowNodeData } from "../../types";
import styles from "./WhileNode.module.css";

export const WhileNode = memo(({ data, selected }: NodeProps<FlowNodeData>) => {
  return (
    <div
      className={styles.whileContainer}
      data-selected={selected}
    >
      <NodeResizer
        className={styles.resizer}
        isVisible={selected}
        minWidth={320}
        minHeight={200}
        lineClassName={`${styles.resizerLine} nopan`}
        handleClassName={`${styles.resizerHandle} nopan`}
        handlePositions={["top-left", "top-right", "bottom-left", "bottom-right"]}
      />
      <div className={styles.surface}>
        <div className={styles.whileHeader}>
          <span className={styles.whileLabel}>⟲ {data.label}</span>
        </div>
        <div className={styles.whileBody}>
          {/* Cette zone contiendra les blocs enfants */}
        </div>
      </div>
    </div>
  );
});

WhileNode.displayName = "WhileNode";

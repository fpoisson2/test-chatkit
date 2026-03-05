/**
 * Custom default node that replaces ReactFlow's built-in default node.
 * Renders the label + an active sessions badge when in production mode.
 */
import { memo, useState, useRef, useEffect } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNodeData } from "../../types";
import { useActiveSessions } from "../../contexts/ActiveSessionsContext";
import styles from "./DefaultNode.module.css";

export const DefaultNode = memo(({ data, id }: NodeProps<FlowNodeData>) => {
  const { sessionsByStep } = useActiveSessions();
  const users = sessionsByStep[data.slug];
  const count = users?.length ?? 0;

  const [showTooltip, setShowTooltip] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close tooltip on outside click
  useEffect(() => {
    if (!showTooltip) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setShowTooltip(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTooltip]);

  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div className={styles.label}>{data.label}</div>
      {count > 0 ? (
        <div
          ref={containerRef}
          className={styles.badgeContainer}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <span
            className={styles.badge}
            onClick={(e) => {
              e.stopPropagation();
              setShowTooltip((v) => !v);
            }}
          >
            {count}
          </span>
          {showTooltip ? (
            <div className={styles.tooltip}>
              {users.map((u) => (
                <a
                  key={u.threadId}
                  className={styles.tooltipLink}
                  href={`/c/${u.threadId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {u.email}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} />
    </>
  );
});

DefaultNode.displayName = "DefaultNode";

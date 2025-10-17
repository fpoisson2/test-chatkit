import { memo, useMemo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import { getConditionConfiguration } from "../../../utils/workflows";
import type { FlowNodeData } from "../../types";

const HANDLE_PREFIX = "condition::";
const DEFAULT_SENTINEL = "__default__";

const createHandleId = (condition: string | null) =>
  `${HANDLE_PREFIX}${encodeURIComponent(condition ?? DEFAULT_SENTINEL)}`;

export const createConditionHandleId = (condition: string | null) =>
  createHandleId(condition);

export const parseConditionHandleId = (
  handleId?: string | null,
): string | null | undefined => {
  if (!handleId || !handleId.startsWith(HANDLE_PREFIX)) {
    return undefined;
  }

  const encoded = handleId.slice(HANDLE_PREFIX.length);
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded === DEFAULT_SENTINEL ? null : decoded;
  } catch (error) {
    console.error("ConditionHandleDecodeError", error);
    return null;
  }
};

type BranchHandle = {
  id: string;
  label: string;
  condition: string | null;
  isDefault: boolean;
};

const defaultHandleStyle = {
  width: 12,
  height: 12,
  borderRadius: "999px",
  background: "#fff",
  border: "2px solid #1e293b",
};

const branchRowStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.25rem 0.75rem 0.25rem 0.5rem",
  borderRadius: "0.65rem",
  background: "rgba(255, 255, 255, 0.75)",
  color: "#0f172a",
  fontSize: "0.82rem",
  fontWeight: 600,
};

const branchBadgeStyle: CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 700,
  lineHeight: 1,
  padding: "0.15rem 0.4rem",
  borderRadius: "999px",
  background: "rgba(37, 99, 235, 0.16)",
  color: "#1d4ed8",
  textTransform: "uppercase",
  letterSpacing: "0.02em",
};

const branchListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
  marginTop: "0.5rem",
};

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
  alignItems: "stretch",
};

const headerStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: "0.95rem",
  textAlign: "left",
  color: "#0f172a",
};

const formatBranchLabel = (label: string, fallback: string): string => {
  const trimmed = label.trim();
  if (trimmed) {
    return trimmed;
  }
  return fallback;
};

const normalizeBranch = (value: string): string | null => {
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
};

const ConditionNode = ({ data, selected }: NodeProps<FlowNodeData>) => {
  const configuration = useMemo(
    () => getConditionConfiguration(data.parameters),
    [data.parameters],
  );

  const normalizedDefault = useMemo(() => {
    if (configuration.kind !== "multi") {
      return null;
    }
    return normalizeBranch(configuration.defaultBranch);
  }, [configuration]);

  const branches = useMemo<BranchHandle[]>(() => {
    if (configuration.kind === "multi") {
      const declared = configuration.branches.map<BranchHandle>((branch, index) => {
        const normalized = normalizeBranch(branch.branch ?? "");
        const label = formatBranchLabel(branch.branch ?? "", `Branche ${index + 1}`);
        return {
          id: createHandleId(normalized),
          label,
          condition: normalized,
          isDefault: normalized != null && normalized === normalizedDefault,
        } satisfies BranchHandle;
      });

      const hasDefaultHandle = normalizedDefault
        ? declared.some((entry) => entry.condition === normalizedDefault)
        : false;

      if (normalizedDefault && !hasDefaultHandle) {
        declared.push({
          id: createHandleId(normalizedDefault),
          label: `Par défaut (${configuration.defaultBranch.trim()})`,
          condition: normalizedDefault,
          isDefault: true,
        });
      } else if (!normalizedDefault) {
        declared.push({
          id: createHandleId(null),
          label: "Par défaut",
          condition: null,
          isDefault: true,
        });
      }

      return declared.length > 0
        ? declared
        : [
            {
              id: createHandleId("true"),
              label: "Branche true",
              condition: "true",
              isDefault: false,
            },
            {
              id: createHandleId("false"),
              label: "Branche false",
              condition: "false",
              isDefault: true,
            },
          ];
    }

    return [
      {
        id: createHandleId("true"),
        label: "Branche true",
        condition: "true",
        isDefault: false,
      },
      {
        id: createHandleId("false"),
        label: "Branche false",
        condition: "false",
        isDefault: true,
      },
    ];
  }, [configuration, normalizedDefault]);

  return (
    <div style={{ ...containerStyle, outline: selected ? "2px solid rgba(15, 23, 42, 0.35)" : "none" }}>
      <Handle
        type="target"
        position={Position.Left}
        style={{
          ...defaultHandleStyle,
          left: -6,
        }}
      />
      <div style={headerStyle}>{data.label}</div>
      <div style={branchListStyle}>
        {branches.map((branch) => (
          <div key={branch.id} style={branchRowStyle}>
            <span>{branch.label}</span>
            {branch.isDefault ? <span style={branchBadgeStyle}>Défaut</span> : null}
            <Handle
              type="source"
              id={branch.id}
              position={Position.Right}
              style={{
                ...defaultHandleStyle,
                right: -6,
                top: "50%",
                transform: "translateY(-50%)",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default memo(ConditionNode);

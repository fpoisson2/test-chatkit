import { type FC, memo, useMemo } from "react";
import { useNodes, BaseEdge, getBezierPath, type EdgeProps, type Node } from "@xyflow/react";
import { getSmartEdge } from "@tisoap/react-flow-smart-edge";

const SmartEdge: FC<EdgeProps> = (props) => {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
    markerStart,
    label,
    labelStyle,
    labelShowBg,
    labelBgStyle,
    labelBgPadding,
    labelBgBorderRadius,
  } = props;

  const nodes = useNodes();

  // Transform nodes to include width/height at top level for compatibility
  // with @tisoap/react-flow-smart-edge which expects v11-style nodes
  const nodesWithDimensions = useMemo(() => {
    return nodes.map((node) => ({
      ...node,
      width: node.measured?.width ?? node.width ?? 150,
      height: node.measured?.height ?? node.height ?? 40,
    }));
  }, [nodes]);

  const result = getSmartEdge({
    sourcePosition,
    targetPosition,
    sourceX,
    sourceY,
    targetX,
    targetY,
    nodes: nodesWithDimensions,
  });

  // If smart edge calculation fails, fallback to bezier
  if (result === null || result instanceof Error) {
    const [path, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });

    return (
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerEnd={markerEnd}
        markerStart={markerStart}
        label={label}
        labelX={labelX}
        labelY={labelY}
        labelStyle={labelStyle}
        labelShowBg={labelShowBg}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
      />
    );
  }

  const { svgPathString, edgeCenterX, edgeCenterY } = result;

  return (
    <BaseEdge
      id={id}
      path={svgPathString}
      style={style}
      markerEnd={markerEnd}
      markerStart={markerStart}
      label={label}
      labelX={edgeCenterX}
      labelY={edgeCenterY}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
    />
  );
};

export default memo(SmartEdge);

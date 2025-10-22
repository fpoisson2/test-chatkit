import { fieldStyle, labelContentStyle } from "../styles";
import { HelpTooltip } from "../components/HelpTooltip";

type EndInspectorSectionProps = {
  nodeId: string;
  endMessage: string;
  onEndMessageChange: (nodeId: string, value: string) => void;
};

export const EndInspectorSection = ({ nodeId, endMessage, onEndMessageChange }: EndInspectorSectionProps) => (
  <label style={fieldStyle}>
    <span style={labelContentStyle}>
      Message de fin
      <HelpTooltip label="Ce message est utilisé comme raison de clôture lorsque ce bloc termine le fil." />
    </span>
    <textarea
      value={endMessage}
      rows={4}
      placeholder="Texte affiché lorsque le workflow se termine sur ce bloc"
      onChange={(event) => onEndMessageChange(nodeId, event.target.value)}
    />
  </label>
);

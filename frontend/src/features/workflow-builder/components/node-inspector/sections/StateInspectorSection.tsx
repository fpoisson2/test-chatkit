import type { StateAssignment } from "../../../types";
import { StateAssignmentsPanel } from "../components/StateAssignmentsPanel";

type StateInspectorSectionProps = {
  nodeId: string;
  globalAssignments: StateAssignment[];
  stateAssignments: StateAssignment[];
  onStateAssignmentsChange: (
    nodeId: string,
    scope: "globals" | "state",
    assignments: StateAssignment[],
  ) => void;
};

export const StateInspectorSection = ({
  nodeId,
  globalAssignments,
  stateAssignments,
  onStateAssignmentsChange,
}: StateInspectorSectionProps) => (
  <>
    <StateAssignmentsPanel
      title="Variables globales"
      description="Définissez des variables disponibles pour l'ensemble du workflow."
      assignments={globalAssignments}
      onChange={(next) => onStateAssignmentsChange(nodeId, "globals", next)}
      expressionPlaceholder="Ex. input.output_parsed"
      targetPlaceholder="global.nom_variable"
      addLabel="Ajouter une variable globale"
      emptyLabel="Aucune variable globale n'est définie pour ce nœud."
    />
    <StateAssignmentsPanel
      title="Variables d'état"
      description="Affectez des valeurs aux variables d'état du workflow."
      assignments={stateAssignments}
      onChange={(next) => onStateAssignmentsChange(nodeId, "state", next)}
      expressionPlaceholder="Ex. input.output_text"
      targetPlaceholder="state.nom_variable"
      addLabel="Ajouter une variable d'état"
      emptyLabel="Aucune variable d'état n'est configurée pour ce nœud."
    />
  </>
);

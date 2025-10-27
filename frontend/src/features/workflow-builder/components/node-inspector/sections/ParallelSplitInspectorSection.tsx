import { useCallback } from "react";

import { useI18n } from "../../../../../i18n";
import type { ParallelBranch } from "../../../types";
import { HelpTooltip } from "../components/HelpTooltip";
import styles from "../NodeInspector.module.css";

type ParallelSplitInspectorSectionProps = {
  nodeId: string;
  joinSlug: string;
  branches: ParallelBranch[];
  onJoinSlugChange: (nodeId: string, value: string) => void;
  onBranchesChange: (nodeId: string, branches: ParallelBranch[]) => void;
};

const MIN_BRANCHES = 2;

export const ParallelSplitInspectorSection = ({
  nodeId,
  joinSlug,
  branches,
  onJoinSlugChange,
  onBranchesChange,
}: ParallelSplitInspectorSectionProps) => {
  const { t } = useI18n();

  const handleJoinSlugChange = useCallback(
    (value: string) => {
      onJoinSlugChange(nodeId, value);
    },
    [nodeId, onJoinSlugChange],
  );

  const handleBranchLabelChange = useCallback(
    (index: number, value: string) => {
      const nextBranches = branches.map((branch, position) =>
        position === index ? { ...branch, label: value } : branch,
      );
      onBranchesChange(nodeId, nextBranches);
    },
    [branches, nodeId, onBranchesChange],
  );

  const handleAddBranch = useCallback(() => {
    const nextBranches = [
      ...branches,
      { slug: `branch-${Date.now()}`, label: "" },
    ];
    onBranchesChange(nodeId, nextBranches);
  }, [branches, nodeId, onBranchesChange]);

  const handleRemoveBranch = useCallback(
    (index: number) => {
      if (branches.length <= MIN_BRANCHES) {
        return;
      }
      const nextBranches = branches.filter((_, position) => position !== index);
      onBranchesChange(nodeId, nextBranches);
    },
    [branches, nodeId, onBranchesChange],
  );

  return (
    <div className={styles.nodeInspectorPanelInnerAccent}>
      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.parallel.joinSlugLabel")}
          <HelpTooltip label={t("workflowBuilder.parallel.joinSlugHelp")} />
        </span>
        <input
          type="text"
          value={joinSlug}
          onChange={(event) => handleJoinSlugChange(event.target.value)}
          placeholder={t("workflowBuilder.parallel.joinSlugPlaceholder")}
        />
      </label>

      <div className={styles.nodeInspectorBranchList}>
        <div className={styles.nodeInspectorSectionHeader}>
          <h3 className={styles.nodeInspectorSectionTitle}>
            {t("workflowBuilder.parallel.branchesTitle")}
          </h3>
          <button
            type="button"
            className={styles.nodeInspectorBranchAddButton}
            onClick={handleAddBranch}
          >
            {t("workflowBuilder.parallel.branchAdd")}
          </button>
        </div>

        {branches.map((branch, index) => (
          <div key={branch.slug} className={styles.nodeInspectorBranchItem}>
            <div className={styles.nodeInspectorBranchHeader}>
              <span className={styles.nodeInspectorSectionTitleSmall}>
                {t("workflowBuilder.parallel.branchLabelLabel", { index: index + 1 })}
              </span>
              <button
                type="button"
                className={styles.nodeInspectorBranchRemoveButton}
                onClick={() => handleRemoveBranch(index)}
                disabled={branches.length <= MIN_BRANCHES}
              >
                {t("workflowBuilder.parallel.branchRemove")}
              </button>
            </div>
            <p className={styles.nodeInspectorBranchSlug}>
              {t("workflowBuilder.parallel.branchSlugLabel", { slug: branch.slug })}
            </p>
            <input
              type="text"
              value={branch.label}
              onChange={(event) => handleBranchLabelChange(index, event.target.value)}
              placeholder={t("workflowBuilder.parallel.branchLabelPlaceholder")}
            />
          </div>
        ))}
      </div>

      {branches.length <= MIN_BRANCHES ? (
        <p className={styles.nodeInspectorHintText}>
          {t("workflowBuilder.parallel.branchMinimum")}
        </p>
      ) : null}
      <p className={styles.nodeInspectorHintText}>
        {t("workflowBuilder.parallel.branchHint")}
      </p>
    </div>
  );
};

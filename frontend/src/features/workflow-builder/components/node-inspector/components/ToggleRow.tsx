import { HelpTooltip } from "./HelpTooltip";
import styles from "../NodeInspector.module.css";

type ToggleSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
};

type ToggleRowProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  help?: string;
  className?: string;
};

export const ToggleSwitch = ({
  checked,
  onChange,
  disabled,
  ariaLabel,
  ariaDescribedBy,
}: ToggleSwitchProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    aria-describedby={ariaDescribedBy}
    onClick={() => {
      if (!disabled) {
        onChange(!checked);
      }
    }}
    disabled={disabled}
    className={[
      styles.nodeInspectorToggleSwitch,
      checked ? styles.nodeInspectorToggleSwitchChecked : "",
      disabled ? styles.nodeInspectorToggleSwitchDisabled : "",
    ]
      .filter(Boolean)
      .join(" ")}
  >
    <span
      className={[
        styles.nodeInspectorToggleSwitchThumb,
        checked ? styles.nodeInspectorToggleSwitchThumbChecked : "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  </button>
);

export const ToggleRow = ({ label, checked, onChange, disabled, help, className }: ToggleRowProps) => {
  const describedById = help ? `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-help` : undefined;

  return (
    <div
      className={[styles.nodeInspectorToggleRow, className].filter(Boolean).join(" ")}
    >
      <span className={styles.nodeInspectorLabel} id={describedById}>
        {label}
        {help ? <HelpTooltip label={help} /> : null}
      </span>
      <ToggleSwitch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        ariaLabel={label}
        ariaDescribedBy={describedById}
      />
    </div>
  );
};

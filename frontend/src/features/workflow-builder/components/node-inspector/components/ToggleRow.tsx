import type { CSSProperties } from "react";

import { labelContentStyle, toggleRowStyle } from "../styles";
import { HelpTooltip } from "./HelpTooltip";

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
};

const switchBaseStyle: CSSProperties = {
  position: "relative",
  width: "2.75rem",
  height: "1.5rem",
  borderRadius: "9999px",
  border: "none",
  padding: 0,
  backgroundColor: "rgba(148, 163, 184, 0.45)",
  cursor: "pointer",
  transition: "background-color 150ms ease",
};

const switchCheckedStyle: CSSProperties = {
  backgroundColor: "#2563eb",
};

const switchDisabledStyle: CSSProperties = {
  cursor: "not-allowed",
  opacity: 0.6,
};

const getSwitchThumbStyle = (checked: boolean): CSSProperties => ({
  position: "absolute",
  top: "50%",
  left: "0.25rem",
  width: "1.15rem",
  height: "1.15rem",
  borderRadius: "9999px",
  backgroundColor: "#fff",
  boxShadow: "0 2px 6px rgba(15, 23, 42, 0.25)",
  transform: `translate(${checked ? "1.2rem" : "0"}, -50%)`,
  transition: "transform 150ms ease",
});

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
    style={{
      ...switchBaseStyle,
      ...(checked ? switchCheckedStyle : {}),
      ...(disabled ? switchDisabledStyle : {}),
    }}
  >
    <span style={getSwitchThumbStyle(checked)} />
  </button>
);

export const ToggleRow = ({ label, checked, onChange, disabled, help }: ToggleRowProps) => {
  const describedById = help ? `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-help` : undefined;

  return (
    <div style={toggleRowStyle}>
      <span style={labelContentStyle} id={describedById}>
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

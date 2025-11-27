/**
 * SidebarSearchInput - Search input for filtering workflows and conversations in the sidebar
 */
import { useRef, useCallback, type ChangeEvent, type KeyboardEvent } from "react";
import "./SidebarSearchInput.css";

export interface SidebarSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export function SidebarSearchInput({
  value,
  onChange,
  placeholder = "Rechercher…",
  ariaLabel = "Rechercher dans la sidebar",
  disabled = false,
}: SidebarSearchInputProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  const handleClear = useCallback(() => {
    onChange("");
    inputRef.current?.focus();
  }, [onChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape" && value) {
        e.preventDefault();
        onChange("");
      }
    },
    [onChange, value]
  );

  return (
    <div className="sidebar-search-input">
      <div className="sidebar-search-input__icon">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      </div>
      <input
        ref={inputRef}
        type="search"
        className="sidebar-search-input__field"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
      />
      {value && (
        <button
          type="button"
          className="sidebar-search-input__clear"
          onClick={handleClear}
          aria-label="Effacer la recherche"
          tabIndex={-1}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default SidebarSearchInput;

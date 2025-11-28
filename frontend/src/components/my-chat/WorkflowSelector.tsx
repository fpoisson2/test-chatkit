/**
 * WorkflowSelector - Dropdown with search to select the active workflow for new conversations
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowSummary } from "../../types/workflows";
import "./WorkflowSelector.css";

export interface WorkflowSelectorProps {
  workflows: WorkflowSummary[];
  selectedWorkflowId: number | null;
  onWorkflowChange: (workflowId: number) => void;
  disabled?: boolean;
}

export function WorkflowSelector({
  workflows,
  selectedWorkflowId,
  onWorkflowChange,
  disabled = false,
}: WorkflowSelectorProps): JSX.Element | null {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback(
    (workflowId: number) => {
      onWorkflowChange(workflowId);
      setIsOpen(false);
      setSearchTerm("");
    },
    [onWorkflowChange]
  );

  const toggleDropdown = useCallback(() => {
    if (!disabled) {
      setIsOpen((prev) => !prev);
      setSearchTerm("");
    }
  }, [disabled]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm("");
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Filter workflows based on search term
  const filteredWorkflows = useMemo(() => {
    if (!searchTerm.trim()) {
      return workflows;
    }
    const lowerSearch = searchTerm.toLowerCase();
    return workflows.filter((workflow) =>
      workflow.display_name.toLowerCase().includes(lowerSearch)
    );
  }, [workflows, searchTerm]);

  // Reset focused index when filtered workflows change
  useEffect(() => {
    setFocusedIndex(-1);
  }, [filteredWorkflows]);

  // Reset focused index when dropdown closes
  useEffect(() => {
    if (!isOpen) {
      setFocusedIndex(-1);
    }
  }, [isOpen]);

  // Scroll focused option into view
  useEffect(() => {
    if (focusedIndex >= 0 && optionsRef.current) {
      const focusedElement = optionsRef.current.children[focusedIndex] as HTMLElement;
      if (focusedElement) {
        focusedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [focusedIndex]);

  // Don't render if there are no workflows
  if (workflows.length === 0) {
    return null;
  }

  const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId);

  // Handle keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setIsOpen(false);
      setSearchTerm("");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredWorkflows.length > 0) {
        setFocusedIndex((prev) =>
          prev < filteredWorkflows.length - 1 ? prev + 1 : 0
        );
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredWorkflows.length > 0) {
        setFocusedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredWorkflows.length - 1
        );
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < filteredWorkflows.length) {
        handleSelect(filteredWorkflows[focusedIndex].id);
      } else if (filteredWorkflows.length === 1) {
        handleSelect(filteredWorkflows[0].id);
      }
    }
  };

  return (
    <div className="workflow-selector" ref={wrapperRef}>
      <div className="workflow-selector__dropdown-wrapper">
        <button
          type="button"
          className="workflow-selector__trigger"
          onClick={toggleDropdown}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <span className="workflow-selector__label">workflow</span>
          <span className="workflow-selector__trigger-text">
            {selectedWorkflow?.display_name ?? "Sélectionner..."}
          </span>
        </button>

        {isOpen && (
          <div className="workflow-selector__dropdown" role="listbox" onKeyDown={handleKeyDown}>
            <div className="workflow-selector__search-wrapper">
              <input
                ref={searchInputRef}
                type="text"
                className="workflow-selector__search"
                placeholder="Rechercher..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className="workflow-selector__options" ref={optionsRef}>
              {filteredWorkflows.length > 0 ? (
                filteredWorkflows.map((workflow, index) => (
                  <div
                    key={workflow.id}
                    className={`workflow-selector__option${
                      workflow.id === selectedWorkflowId
                        ? " workflow-selector__option--selected"
                        : ""
                    }${index === focusedIndex ? " workflow-selector__option--focused" : ""}`}
                    role="option"
                    aria-selected={workflow.id === selectedWorkflowId}
                    onClick={() => handleSelect(workflow.id)}
                    onMouseEnter={() => setFocusedIndex(index)}
                  >
                    {workflow.display_name}
                  </div>
                ))
              ) : (
                <div className="workflow-selector__no-results">Aucun résultat</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkflowSelector;

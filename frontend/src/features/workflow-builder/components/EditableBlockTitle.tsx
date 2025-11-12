import { useState, useRef, useEffect, type KeyboardEvent, type FocusEvent } from "react";
import styles from "./EditableBlockTitle.module.css";

interface EditableBlockTitleProps {
  value: string;
  nodeId: string;
  onSave: (nodeId: string, value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * EditableBlockTitle - An inline editable title component
 * Click to edit, Enter to save, Escape to cancel
 */
export default function EditableBlockTitle({
  value,
  nodeId,
  onSave,
  placeholder = "Bloc",
  className = "",
}: EditableBlockTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update editValue when value prop changes
  useEffect(() => {
    setEditValue(value);
  }, [value]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmedValue = editValue.trim();
    if (trimmedValue !== value) {
      onSave(nodeId, editValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSave();
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleCancel();
    }
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    handleSave();
  };

  const handleClick = () => {
    if (!isEditing) {
      setIsEditing(true);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={`${styles.editableInput} ${className}`}
        placeholder={placeholder}
      />
    );
  }

  return (
    <h2
      onClick={handleClick}
      className={`${styles.editableTitle} ${className}`}
      title="Cliquer pour éditer"
    >
      {value || placeholder}
    </h2>
  );
}

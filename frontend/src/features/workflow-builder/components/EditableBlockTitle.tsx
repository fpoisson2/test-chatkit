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
    <div className={styles.editableTitleWrapper}>
      <h2
        onClick={handleClick}
        className={`${styles.editableTitle} ${className}`}
        title="Cliquer pour éditer"
      >
        {value || placeholder}
      </h2>
      <svg
        className={styles.editIcon}
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        onClick={handleClick}
      >
        <path
          d="M11.333 2.00004C11.5081 1.82494 11.716 1.68605 11.9447 1.59129C12.1735 1.49653 12.4187 1.44775 12.6663 1.44775C12.914 1.44775 13.1592 1.49653 13.3879 1.59129C13.6167 1.68605 13.8246 1.82494 13.9997 2.00004C14.1748 2.17513 14.3137 2.383 14.4084 2.61178C14.5032 2.84055 14.552 3.08575 14.552 3.33337C14.552 3.58099 14.5032 3.82619 14.4084 4.05497C14.3137 4.28374 14.1748 4.49161 13.9997 4.66671L5.16634 13.5L1.83301 14.3334L2.66634 11L11.333 2.00004Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

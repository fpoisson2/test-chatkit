export const getWorkflowInitials = (label: string) => {
  const trimmed = label.trim();

  if (!trimmed) {
    return "?";
  }

  const words = trimmed.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "?";
  }

  if (words.length === 1) {
    return trimmed.slice(0, 2).toUpperCase();
  }

  return (words[0]?.charAt(0) ?? "").concat(words[1]?.charAt(0) ?? "").toUpperCase();
};

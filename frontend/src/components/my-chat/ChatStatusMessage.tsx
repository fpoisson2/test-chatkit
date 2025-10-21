type ChatStatusMessageProps = {
  message: string | null;
  isError?: boolean;
  isLoading?: boolean;
};

export const ChatStatusMessage = ({ message, isError = false, isLoading = false }: ChatStatusMessageProps) => {
  if (!message) {
    return null;
  }

  const statusClassName = [
    "chatkit-status",
    isError ? "chatkit-status--error" : "",
    !isError && isLoading ? "chatkit-status--loading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={statusClassName} role="status" aria-live="polite">
      {message}
    </div>
  );
};

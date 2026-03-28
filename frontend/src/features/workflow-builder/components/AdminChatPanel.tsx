/**
 * Floating admin chat panel for the workflow builder.
 * Allows the admin to ask questions about student progress and thread content.
 */
import { MessageCircle, Send, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../../../auth";
import styles from "./AdminChatPanel.module.css";

type AdminChatPanelProps = {
  workflowId: number;
};

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
}

export const AdminChatPanel = memo(({ workflowId }: AdminChatPanelProps) => {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Reset conversation when workflow changes
  useEffect(() => {
    setMessages([]);
  }, [workflowId]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming || !token) return;

      const userMsg: ChatMessage = { role: "user", content: text.trim() };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      setInput("");
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const resp = await fetch(
          `/api/workflows/${workflowId}/admin-chat`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              messages: newMessages.filter((m) => m.role !== "tool").map((m) => ({
                role: m.role,
                content: m.content,
              })),
            }),
            signal: controller.signal,
          },
        );

        if (!resp.ok || !resp.body) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Erreur de connexion." },
          ]);
          setIsStreaming(false);
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let assistantContent = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const dataStr = line.slice(6);

            try {
              const event = JSON.parse(dataStr);

              if (event.type === "delta") {
                assistantContent += event.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                    updated[lastIdx] = {
                      ...updated[lastIdx],
                      content: assistantContent,
                    };
                  } else {
                    updated.push({
                      role: "assistant",
                      content: assistantContent,
                    });
                  }
                  return updated;
                });
              } else if (event.type === "tool_call") {
                setMessages((prev) => [
                  ...prev,
                  { role: "tool", content: event.name },
                ]);
                // Reset assistant content for post-tool response
                assistantContent = "";
              } else if (event.type === "error") {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    content: `Erreur: ${event.error}`,
                  },
                ]);
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Erreur de connexion." },
          ]);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, isStreaming, token, workflowId],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const toolNameMap: Record<string, string> = {
    get_student_progress: "Vérification de la progression...",
    read_student_thread: "Lecture de la conversation...",
    list_workflow_steps: "Consultation des étapes...",
    improve_step_content: "Amélioration du contenu...",
    publish_step_message: "Publication du message...",
    update_step_config: "Mise à jour de la config...",
    unlock_student: "Déblocage de l'étudiant...",
  };

  return (
    <div className={styles.chatContainer}>
      <button
        className={`${styles.chatButton} ${open ? styles.chatButtonActive : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Chat admin"
      >
        <MessageCircle size={20} />
      </button>

      {open && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Assistant admin</span>
            <button
              className={styles.closeButton}
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </div>

          <div className={styles.messages}>
            {messages.length === 0 && (
              <div
                className={styles.messageAssistant}
                style={{
                  alignSelf: "flex-start",
                  opacity: 0.7,
                  fontSize: 13,
                }}
              >
                Posez une question sur la progression des étudiants ou le
                contenu du workflow.
              </div>
            )}
            {messages.map((msg, i) => {
              if (msg.role === "tool") {
                return (
                  <div key={i} className={styles.messageToolCall}>
                    {toolNameMap[msg.content] ?? msg.content}
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className={`${styles.message} ${
                    msg.role === "user"
                      ? styles.messageUser
                      : styles.messageAssistant
                  }`}
                >
                  {msg.content}
                </div>
              );
            })}
            {isStreaming &&
              messages[messages.length - 1]?.role !== "assistant" && (
                <div className={styles.thinking}>
                  <div className={styles.thinkingDot} />
                  <div className={styles.thinkingDot} />
                  <div className={styles.thinkingDot} />
                </div>
              )}
            <div ref={messagesEndRef} />
          </div>

          <form className={styles.composerForm} onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              className={styles.composerInput}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Poser une question..."
              disabled={isStreaming}
            />
            <button
              type="submit"
              className={styles.sendButton}
              disabled={!input.trim() || isStreaming}
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
});

AdminChatPanel.displayName = "AdminChatPanel";

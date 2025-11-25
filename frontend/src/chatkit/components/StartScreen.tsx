/**
 * Composant d'écran de démarrage avec salutation et suggestions de prompts
 */
import React from 'react';
import type { StartScreenPrompt } from '../types';

export interface StartScreenProps {
  greeting?: string;
  prompts?: StartScreenPrompt[];
  onPromptClick: (prompt: string) => void;
}

export function StartScreen({ greeting, prompts, onPromptClick }: StartScreenProps): JSX.Element {
  return (
    <div className="chatkit-start-screen">
      {greeting && (
        <div className="chatkit-start-greeting">{greeting}</div>
      )}
      {prompts && prompts.length > 0 && (
        <div className="chatkit-start-prompts">
          {prompts.map((prompt, idx) => (
            <button
              key={idx}
              className="chatkit-start-prompt"
              onClick={() => onPromptClick(prompt.prompt)}
            >
              {prompt.icon && <span className="chatkit-prompt-icon">{prompt.icon}</span>}
              <span>{prompt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default StartScreen;

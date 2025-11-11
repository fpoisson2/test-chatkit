import React, { useState } from 'react';
import { agentPresets, type AgentPreset } from './agentPresets';
import styles from './PresetSelector.module.css';

interface PresetSelectorProps {
  onSelect: (preset: AgentPreset) => void;
  onCancel?: () => void;
}

type CategoryFilter = 'all' | 'beginner' | 'common' | 'advanced';

export const PresetSelector: React.FC<PresetSelectorProps> = ({
  onSelect,
  onCancel,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const filteredPresets = categoryFilter === 'all'
    ? agentPresets
    : agentPresets.filter(preset => preset.category === categoryFilter);

  return (
    <div className={styles.presetSelector}>
      <div className={styles.header}>
        <h3 className={styles.title}>Choisir un type d'agent</h3>
        <p className={styles.subtitle}>
          Commencez avec un template pré-configuré ou créez votre propre configuration
        </p>
      </div>

      <div className={styles.filters}>
        <button
          className={`${styles.filterButton} ${categoryFilter === 'all' ? styles.filterButtonActive : ''}`}
          onClick={() => setCategoryFilter('all')}
        >
          Tous
        </button>
        <button
          className={`${styles.filterButton} ${categoryFilter === 'beginner' ? styles.filterButtonActive : ''}`}
          onClick={() => setCategoryFilter('beginner')}
        >
          Débutant
        </button>
        <button
          className={`${styles.filterButton} ${categoryFilter === 'common' ? styles.filterButtonActive : ''}`}
          onClick={() => setCategoryFilter('common')}
        >
          Courants
        </button>
        <button
          className={`${styles.filterButton} ${categoryFilter === 'advanced' ? styles.filterButtonActive : ''}`}
          onClick={() => setCategoryFilter('advanced')}
        >
          Avancé
        </button>
      </div>

      <div className={styles.presetGrid}>
        {filteredPresets.map(preset => {
          const Icon = preset.icon;
          return (
            <button
              key={preset.id}
              className={styles.presetCard}
              onClick={() => onSelect(preset)}
            >
              <div className={styles.presetIcon}>
                <Icon size={28} />
              </div>
              <h4 className={styles.presetName}>{preset.name}</h4>
              <p className={styles.presetDescription}>{preset.description}</p>
              <div className={styles.presetCategory}>
                {preset.category === 'beginner' && '🌱 Débutant'}
                {preset.category === 'common' && '⭐ Populaire'}
                {preset.category === 'advanced' && '🚀 Avancé'}
              </div>
            </button>
          );
        })}
      </div>

      {onCancel && (
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onCancel}>
            Annuler
          </button>
        </div>
      )}
    </div>
  );
};

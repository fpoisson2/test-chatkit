import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './JsonSchemaBuilder.module.css';
import { Trash2, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  description?: string;
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  enum?: string[];
  default?: unknown;
}

interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

interface JsonSchemaBuilderProps {
  schema: JsonSchema;
  onChange: (schema: JsonSchema) => void;
  onError: (error: string | null) => void;
}

interface PropertyEditorProps {
  name: string;
  property: JsonSchemaProperty;
  isRequired: boolean;
  onNameChange: (oldName: string, newName: string) => void;
  onPropertyChange: (name: string, property: JsonSchemaProperty) => void;
  onRequiredChange: (name: string, required: boolean) => void;
  onDelete: (name: string) => void;
  depth?: number;
}

const AVAILABLE_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
] as const;

function PropertyEditor({
  name,
  property,
  isRequired,
  onNameChange,
  onPropertyChange,
  onRequiredChange,
  onDelete,
  depth = 0,
}: PropertyEditorProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(name);

  const handleTypeChange = useCallback(
    (newType: JsonSchemaProperty['type']) => {
      const newProperty: JsonSchemaProperty = { type: newType };

      if (newType === 'object') {
        newProperty.properties = {};
      } else if (newType === 'array') {
        newProperty.items = { type: 'string' };
      }

      onPropertyChange(name, newProperty);
    },
    [name, onPropertyChange]
  );

  const handleDescriptionChange = useCallback(
    (description: string) => {
      onPropertyChange(name, {
        ...property,
        description: description || undefined,
      });
    },
    [name, property, onPropertyChange]
  );

  const handleAddNestedProperty = useCallback(() => {
    if (property.type !== 'object') return;

    const properties = property.properties || {};
    let newPropertyName = 'new_property';
    let counter = 1;

    while (properties[newPropertyName]) {
      newPropertyName = `new_property_${counter}`;
      counter++;
    }

    onPropertyChange(name, {
      ...property,
      properties: {
        ...properties,
        [newPropertyName]: { type: 'string' },
      },
    });
  }, [name, property, onPropertyChange]);

  const handleNestedPropertyChange = useCallback(
    (propName: string, propValue: JsonSchemaProperty) => {
      if (property.type !== 'object') return;

      onPropertyChange(name, {
        ...property,
        properties: {
          ...property.properties,
          [propName]: propValue,
        },
      });
    },
    [name, property, onPropertyChange]
  );

  const handleNestedPropertyNameChange = useCallback(
    (oldName: string, newName: string) => {
      if (property.type !== 'object' || !property.properties) return;

      const { [oldName]: prop, ...rest } = property.properties;
      onPropertyChange(name, {
        ...property,
        properties: {
          ...rest,
          [newName]: prop,
        },
      });
    },
    [name, property, onPropertyChange]
  );

  const handleDeleteNestedProperty = useCallback(
    (propName: string) => {
      if (property.type !== 'object' || !property.properties) return;

      const { [propName]: _, ...rest } = property.properties;
      onPropertyChange(name, {
        ...property,
        properties: rest,
      });
    },
    [name, property, onPropertyChange]
  );

  const handleArrayItemsChange = useCallback(
    (items: JsonSchemaProperty) => {
      if (property.type !== 'array') return;

      onPropertyChange(name, {
        ...property,
        items,
      });
    },
    [name, property, onPropertyChange]
  );

  const handleNameBlur = useCallback(() => {
    setEditingName(false);
    if (tempName && tempName !== name) {
      onNameChange(name, tempName);
    } else {
      setTempName(name);
    }
  }, [name, tempName, onNameChange]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleNameBlur();
      } else if (e.key === 'Escape') {
        setTempName(name);
        setEditingName(false);
      }
    },
    [handleNameBlur, name]
  );

  return (
    <div className={styles.propertyEditor} style={{ marginLeft: `${depth * 20}px` }}>
      <div className={styles.propertyHeader}>
        {property.type === 'object' && (
          <button
            type="button"
            className={styles.expandButton}
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label={isExpanded ? t('workflowBuilder.agentInspector.jsonSchemaCollapse') : t('workflowBuilder.agentInspector.jsonSchemaExpand')}
          >
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}

        <div className={styles.propertyName}>
          {editingName ? (
            <input
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={handleNameKeyDown}
              autoFocus
              className={styles.nameInput}
            />
          ) : (
            <span
              onClick={() => {
                setEditingName(true);
                setTempName(name);
              }}
              className={styles.nameLabel}
            >
              {name}
            </span>
          )}
        </div>

        <select
          value={property.type}
          onChange={(e) => handleTypeChange(e.target.value as JsonSchemaProperty['type'])}
          className={styles.typeSelect}
        >
          {AVAILABLE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <label className={styles.requiredCheckbox}>
          <input
            type="checkbox"
            checked={isRequired}
            onChange={(e) => onRequiredChange(name, e.target.checked)}
          />
          <span>{t('workflowBuilder.agentInspector.jsonSchemaRequired')}</span>
        </label>

        <button
          type="button"
          onClick={() => onDelete(name)}
          className={styles.deleteButton}
          aria-label={t('workflowBuilder.agentInspector.jsonSchemaDeleteProperty')}
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className={styles.propertyDetails}>
        <input
          type="text"
          value={property.description || ''}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          placeholder={t('workflowBuilder.agentInspector.jsonSchemaDescriptionPlaceholder')}
          className={styles.descriptionInput}
        />
      </div>

      {property.type === 'object' && isExpanded && (
        <div className={styles.nestedProperties}>
          {property.properties &&
            Object.entries(property.properties).map(([propName, propValue]) => (
              <PropertyEditor
                key={propName}
                name={propName}
                property={propValue}
                isRequired={false}
                onNameChange={handleNestedPropertyNameChange}
                onPropertyChange={handleNestedPropertyChange}
                onRequiredChange={() => {}}
                onDelete={handleDeleteNestedProperty}
                depth={depth + 1}
              />
            ))}
          <button
            type="button"
            onClick={handleAddNestedProperty}
            className={styles.addPropertyButton}
            style={{ marginLeft: `${(depth + 1) * 20}px` }}
          >
            <Plus size={16} />
            {t('workflowBuilder.agentInspector.jsonSchemaAddProperty')}
          </button>
        </div>
      )}

      {property.type === 'array' && isExpanded && property.items && (
        <div className={styles.arrayItems}>
          <div className={styles.arrayItemsLabel}>
            {t('workflowBuilder.agentInspector.jsonSchemaArrayItems')}
          </div>
          <select
            value={property.items.type}
            onChange={(e) =>
              handleArrayItemsChange({
                type: e.target.value as JsonSchemaProperty['type'],
              })
            }
            className={styles.typeSelect}
            style={{ marginLeft: `${(depth + 1) * 20}px` }}
          >
            {AVAILABLE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export function JsonSchemaBuilder({ schema, onChange, onError }: JsonSchemaBuilderProps) {
  const { t } = useTranslation();
  const [showPreview, setShowPreview] = useState(false);

  const handleAddProperty = useCallback(() => {
    let newPropertyName = 'new_property';
    let counter = 1;

    while (schema.properties[newPropertyName]) {
      newPropertyName = `new_property_${counter}`;
      counter++;
    }

    onChange({
      ...schema,
      properties: {
        ...schema.properties,
        [newPropertyName]: { type: 'string' },
      },
    });
  }, [schema, onChange]);

  const handlePropertyChange = useCallback(
    (name: string, property: JsonSchemaProperty) => {
      onChange({
        ...schema,
        properties: {
          ...schema.properties,
          [name]: property,
        },
      });
    },
    [schema, onChange]
  );

  const handlePropertyNameChange = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName || schema.properties[newName]) return;

      const { [oldName]: prop, ...rest } = schema.properties;

      const newRequired = schema.required
        ? schema.required.map((r) => (r === oldName ? newName : r))
        : undefined;

      onChange({
        ...schema,
        properties: {
          ...rest,
          [newName]: prop,
        },
        required: newRequired,
      });
    },
    [schema, onChange]
  );

  const handleRequiredChange = useCallback(
    (name: string, required: boolean) => {
      const currentRequired = schema.required || [];
      const newRequired = required
        ? [...currentRequired.filter((r) => r !== name), name]
        : currentRequired.filter((r) => r !== name);

      onChange({
        ...schema,
        required: newRequired.length > 0 ? newRequired : undefined,
      });
    },
    [schema, onChange]
  );

  const handleDeleteProperty = useCallback(
    (name: string) => {
      const { [name]: _, ...rest } = schema.properties;

      const newRequired = schema.required?.filter((r) => r !== name);

      onChange({
        ...schema,
        properties: rest,
        required: newRequired && newRequired.length > 0 ? newRequired : undefined,
      });
    },
    [schema, onChange]
  );

  const previewJson = useMemo(() => {
    try {
      return JSON.stringify(schema, null, 2);
    } catch (error) {
      return t('workflowBuilder.agentInspector.jsonSchemaInvalid');
    }
  }, [schema, t]);

  return (
    <div className={styles.jsonSchemaBuilder}>
      <div className={styles.builderHeader}>
        <h3>{t('workflowBuilder.agentInspector.jsonSchemaBuilderTitle')}</h3>
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          className={styles.previewToggle}
        >
          {showPreview
            ? t('workflowBuilder.agentInspector.jsonSchemaHidePreview')
            : t('workflowBuilder.agentInspector.jsonSchemaShowPreview')}
        </button>
      </div>

      <div className={styles.builderContent}>
        <div className={styles.propertiesList}>
          {Object.entries(schema.properties).map(([name, property]) => (
            <PropertyEditor
              key={name}
              name={name}
              property={property}
              isRequired={schema.required?.includes(name) || false}
              onNameChange={handlePropertyNameChange}
              onPropertyChange={handlePropertyChange}
              onRequiredChange={handleRequiredChange}
              onDelete={handleDeleteProperty}
            />
          ))}

          <button
            type="button"
            onClick={handleAddProperty}
            className={styles.addPropertyButton}
          >
            <Plus size={16} />
            {t('workflowBuilder.agentInspector.jsonSchemaAddProperty')}
          </button>
        </div>

        {showPreview && (
          <div className={styles.preview}>
            <h4>{t('workflowBuilder.agentInspector.jsonSchemaPreview')}</h4>
            <pre className={styles.previewCode}>{previewJson}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import styles from "../NodeInspector.module.css";

export type SchemaPropertyType = "string" | "number" | "boolean" | "object" | "array" | "enum";

export interface SchemaProperty {
  name: string;
  type: SchemaPropertyType;
  description?: string;
  enum?: string[];
  properties?: SchemaProperty[];
  items?: SchemaProperty;
  required?: boolean;
}

interface SchemaBuilderProps {
  schema: SchemaProperty[];
  onChange: (schema: SchemaProperty[]) => void;
}

export function SchemaBuilder({ schema, onChange }: SchemaBuilderProps) {
  const addProperty = () => {
    const newProperty: SchemaProperty = {
      name: "",
      type: "string",
      description: "",
      required: false,
    };
    onChange([...schema, newProperty]);
  };

  const updateProperty = (index: number, updates: Partial<SchemaProperty>) => {
    const newSchema = [...schema];
    newSchema[index] = { ...newSchema[index], ...updates };
    onChange(newSchema);
  };

  const removeProperty = (index: number) => {
    const newSchema = schema.filter((_, i) => i !== index);
    onChange(newSchema);
  };

  const addNestedProperty = (parentIndex: number) => {
    const parent = schema[parentIndex];
    if (parent.type === "object") {
      const newProperty: SchemaProperty = {
        name: "",
        type: "string",
        description: "",
        required: false,
      };
      updateProperty(parentIndex, {
        properties: [...(parent.properties || []), newProperty],
      });
    }
  };

  return (
    <div className={styles.schemaBuilder}>
      <div className={styles.schemaBuilderHeader}>
        <h4>Propriétés du schéma</h4>
        <button
          type="button"
          onClick={addProperty}
          className={styles.schemaBuilderAddButton}
        >
          + Ajouter une propriété
        </button>
      </div>

      <div className={styles.schemaBuilderProperties}>
        {schema.map((property, index) => (
          <PropertyEditor
            key={index}
            property={property}
            onChange={(updates) => updateProperty(index, updates)}
            onRemove={() => removeProperty(index)}
            onAddNested={() => addNestedProperty(index)}
          />
        ))}
      </div>
    </div>
  );
}

interface PropertyEditorProps {
  property: SchemaProperty;
  onChange: (updates: Partial<SchemaProperty>) => void;
  onRemove: () => void;
  onAddNested?: () => void;
}

function PropertyEditor({ property, onChange, onRemove, onAddNested }: PropertyEditorProps) {
  const [showEnumValues, setShowEnumValues] = useState(false);

  const handleTypeChange = (type: SchemaPropertyType) => {
    const updates: Partial<SchemaProperty> = { type };

    // Reset type-specific fields when changing type
    if (type !== "enum") {
      updates.enum = undefined;
    }
    if (type !== "object") {
      updates.properties = undefined;
    }
    if (type !== "array") {
      updates.items = undefined;
    }

    onChange(updates);
  };

  const addEnumValue = () => {
    const currentEnum = property.enum || [];
    onChange({ enum: [...currentEnum, ""] });
  };

  const updateEnumValue = (enumIndex: number, value: string) => {
    const currentEnum = property.enum || [];
    const newEnum = [...currentEnum];
    newEnum[enumIndex] = value;
    onChange({ enum: newEnum });
  };

  const removeEnumValue = (enumIndex: number) => {
    const currentEnum = property.enum || [];
    const newEnum = currentEnum.filter((_, i) => i !== enumIndex);
    onChange({ enum: newEnum });
  };

  return (
    <div className={styles.schemaProperty}>
      <div className={styles.schemaPropertyHeader}>
        <input
          type="text"
          placeholder="Nom de la propriété"
          value={property.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className={styles.schemaPropertyName}
        />

        <select
          value={property.type}
          onChange={(e) => handleTypeChange(e.target.value as SchemaPropertyType)}
          className={styles.schemaPropertyType}
        >
          <option value="string">Texte (STR)</option>
          <option value="number">Nombre</option>
          <option value="boolean">Booléen (BOOL)</option>
          <option value="enum">Énumération (ENUM)</option>
          <option value="object">Objet (OBJ)</option>
          <option value="array">Tableau (ARR)</option>
        </select>

        <label className={styles.schemaPropertyRequired}>
          <input
            type="checkbox"
            checked={property.required || false}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          Requis
        </label>

        <button
          type="button"
          onClick={onRemove}
          className={styles.schemaPropertyRemove}
        >
          ×
        </button>
      </div>

      <div className={styles.schemaPropertyDetails}>
        <input
          type="text"
          placeholder="Description (optionnel)"
          value={property.description || ""}
          onChange={(e) => onChange({ description: e.target.value })}
          className={styles.schemaPropertyDescription}
        />

        {property.type === "enum" && (
          <div className={styles.schemaEnumValues}>
            <button
              type="button"
              onClick={() => setShowEnumValues(!showEnumValues)}
              className={styles.schemaEnumToggle}
            >
              Valeurs d'énumération {showEnumValues ? "▼" : "▶"}
            </button>

            {showEnumValues && (
              <div className={styles.schemaEnumList}>
                {(property.enum || []).map((value, enumIndex) => (
                  <div key={enumIndex} className={styles.schemaEnumItem}>
                    <input
                      type="text"
                      placeholder="Valeur"
                      value={value}
                      onChange={(e) => updateEnumValue(enumIndex, e.target.value)}
                      className={styles.schemaEnumInput}
                    />
                    <button
                      type="button"
                      onClick={() => removeEnumValue(enumIndex)}
                      className={styles.schemaEnumRemove}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addEnumValue}
                  className={styles.schemaEnumAdd}
                >
                  + Ajouter une valeur
                </button>
              </div>
            )}
          </div>
        )}

        {property.type === "object" && (
          <div className={styles.schemaObjectProperties}>
            <div className={styles.schemaObjectHeader}>
              <span>Propriétés de l'objet :</span>
              <button
                type="button"
                onClick={onAddNested}
                className={styles.schemaObjectAddProperty}
              >
                + Ajouter une propriété
              </button>
            </div>

            {property.properties && property.properties.length > 0 && (
              <div className={styles.schemaNestedProperties}>
                {property.properties.map((nestedProp, nestedIndex) => (
                  <div key={nestedIndex} className={styles.schemaNestedProperty}>
                    <PropertyEditor
                      property={nestedProp}
                      onChange={(updates) => {
                        const newProperties = [...(property.properties || [])];
                        newProperties[nestedIndex] = { ...newProperties[nestedIndex], ...updates };
                        onChange({ properties: newProperties });
                      }}
                      onRemove={() => {
                        const newProperties = (property.properties || []).filter((_, i) => i !== nestedIndex);
                        onChange({ properties: newProperties });
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {property.type === "array" && (
          <div className={styles.schemaArrayType}>
            <span>Type des éléments :</span>
            <select
              value={property.items?.type || "string"}
              onChange={(e) => onChange({
                items: {
                  name: "item",
                  type: e.target.value as SchemaPropertyType,
                  description: "Élément du tableau"
                }
              })}
              className={styles.schemaArrayItemType}
            >
              <option value="string">Texte</option>
              <option value="number">Nombre</option>
              <option value="boolean">Booléen</option>
              <option value="object">Objet</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
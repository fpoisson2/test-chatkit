import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { WidgetComponent, WidgetRoot } from '../types';

// Import des composants widgets individuels
import { TextComponent } from './Text';
import { TitleComponent } from './Title';
import { CaptionComponent } from './Caption';
import { MarkdownComponent } from './Markdown';
import { BoxComponent } from './Box';
import { RowComponent } from './Row';
import { ColComponent } from './Col';
import { CardComponent } from './Card';
import { ListViewComponent } from './ListView';

// Import des composants simples
import {
  BadgeComponent,
  DividerComponent,
  IconComponent,
  ImageComponent,
  SpacerComponent,
} from './SimpleWidgets';

// Import des composants de formulaire
import {
  ButtonComponent,
  InputComponent,
  TextareaComponent,
  SelectComponent,
  CheckboxComponent,
  RadioGroupComponent,
  DatePickerComponent,
  LabelComponent,
  FormComponent,
  TransitionComponent,
  ChartComponent,
} from './FormWidgets';

/**
 * Context pour passer les callbacks d'actions aux composants
 */
export interface WidgetContext {
  onAction?: (action: unknown) => void;
  onFormData?: (data: FormData) => void;
}

const WidgetContextProvider = React.createContext<WidgetContext>({});

export const useWidgetContext = () => React.useContext(WidgetContextProvider);

export interface WidgetRendererProps {
  widget: WidgetComponent | WidgetRoot;
  context?: WidgetContext;
}

/**
 * Rend un composant widget basé sur son type
 */
export function WidgetRenderer({ widget, context = {} }: WidgetRendererProps): JSX.Element | null {
  if (!widget || !widget.type) {
    console.warn('[WidgetRenderer] Invalid widget:', widget);
    return null;
  }

  const contextValue = context;

  switch (widget.type) {
    // Texte
    case 'Text':
      return <TextComponent {...widget} />;
    case 'Title':
      return <TitleComponent {...widget} />;
    case 'Caption':
      return <CaptionComponent {...widget} />;
    case 'Markdown':
      return <MarkdownComponent {...widget} />;

    // Affichage
    case 'Badge':
      return <BadgeComponent {...widget} />;
    case 'Icon':
      return <IconComponent {...widget} />;
    case 'Image':
      return <ImageComponent {...widget} />;
    case 'Divider':
      return <DividerComponent {...widget} />;
    case 'Spacer':
      return <SpacerComponent {...widget} />;

    // Layout
    case 'Box':
      return <BoxComponent {...widget} />;
    case 'Row':
      return <RowComponent {...widget} />;
    case 'Col':
      return <ColComponent {...widget} />;
    case 'Card':
      return <CardComponent {...widget} />;
    case 'ListView':
      return <ListViewComponent {...widget} />;

    // Formulaires
    case 'Form':
      return <FormComponent {...widget} />;
    case 'Button':
      return <ButtonComponent {...widget} />;
    case 'Input':
      return <InputComponent {...widget} />;
    case 'Textarea':
      return <TextareaComponent {...widget} />;
    case 'Select':
      return <SelectComponent {...widget} />;
    case 'Checkbox':
      return <CheckboxComponent {...widget} />;
    case 'RadioGroup':
      return <RadioGroupComponent {...widget} />;
    case 'DatePicker':
      return <DatePickerComponent {...widget} />;
    case 'Label':
      return <LabelComponent {...widget} />;

    // Utilitaires
    case 'Transition':
      return <TransitionComponent {...widget} />;
    case 'Chart':
      return <ChartComponent {...widget} />;

    default:
      console.warn(`[WidgetRenderer] Unknown widget type: ${widget.type}`);
      return (
        <div style={{ padding: '8px', background: '#fee', border: '1px solid #fcc', borderRadius: '4px' }}>
          Unknown widget type: {widget.type}
        </div>
      );
  }
}

/**
 * Rend une liste de widgets
 */
export interface WidgetListRendererProps {
  widgets: (WidgetComponent | WidgetRoot)[];
  context?: WidgetContext;
}

export function WidgetListRenderer({ widgets, context }: WidgetListRendererProps): JSX.Element {
  return (
    <WidgetContextProvider.Provider value={context || {}}>
      <div className="widget-list">
        {widgets.map((widget, index) => (
          <WidgetRenderer
            key={widget.key || widget.id || `widget-${index}`}
            widget={widget}
            context={context}
          />
        ))}
      </div>
    </WidgetContextProvider.Provider>
  );
}

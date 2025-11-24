import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatKitAPIConfig, WidgetComponent, WidgetRoot } from '../types';

// Import des composants widgets individuels
import { TextComponent } from './Text';
import { TitleComponent } from './Title';
import { CaptionComponent } from './Caption';
import { MarkdownComponent } from './Markdown';
import { BoxComponent } from './Box';
import { RowComponent } from './Row';
import { ColComponent } from './Col';
import { CardComponent } from './Card';
import { ComputerUseWidgetComponent } from './ComputerUse';

// Import des composants simples
import {
  BadgeComponent,
  DividerComponent,
  IconComponent,
  ImageComponent,
  SpacerComponent,
  ListViewComponent,
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
  apiConfig?: ChatKitAPIConfig;
  authToken?: string;
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

  let rendered: JSX.Element | null = null;

  switch (widget.type) {
    // Texte
    case 'Text':
      rendered = <TextComponent {...widget} />;
      break;
    case 'Title':
      rendered = <TitleComponent {...widget} />;
      break;
    case 'Caption':
      rendered = <CaptionComponent {...widget} />;
      break;
    case 'Markdown':
      rendered = <MarkdownComponent {...widget} />;
      break;

    // Affichage
    case 'Badge':
      rendered = <BadgeComponent {...widget} />;
      break;
    case 'Icon':
      rendered = <IconComponent {...widget} />;
      break;
    case 'Image':
      rendered = <ImageComponent {...widget} />;
      break;
    case 'Divider':
      rendered = <DividerComponent {...widget} />;
      break;
    case 'Spacer':
      rendered = <SpacerComponent {...widget} />;
      break;

    // Layout
    case 'Box':
      rendered = <BoxComponent {...widget} />;
      break;
    case 'Row':
      rendered = <RowComponent {...widget} />;
      break;
    case 'Col':
      rendered = <ColComponent {...widget} />;
      break;
    case 'Card':
      rendered = <CardComponent {...widget} />;
      break;
    case 'ListView':
      rendered = <ListViewComponent {...widget} />;
      break;

    case 'ComputerUse':
      rendered = <ComputerUseWidgetComponent {...widget} />;
      break;

    // Formulaires
    case 'Form':
      rendered = <FormComponent {...widget} />;
      break;
    case 'Button':
      rendered = <ButtonComponent {...widget} />;
      break;
    case 'Input':
      rendered = <InputComponent {...widget} />;
      break;
    case 'Textarea':
      rendered = <TextareaComponent {...widget} />;
      break;
    case 'Select':
      rendered = <SelectComponent {...widget} />;
      break;
    case 'Checkbox':
      rendered = <CheckboxComponent {...widget} />;
      break;
    case 'RadioGroup':
      rendered = <RadioGroupComponent {...widget} />;
      break;
    case 'DatePicker':
      rendered = <DatePickerComponent {...widget} />;
      break;
    case 'Label':
      rendered = <LabelComponent {...widget} />;
      break;

    // Utilitaires
    case 'Transition':
      rendered = <TransitionComponent {...widget} />;
      break;
    case 'Chart':
      rendered = <ChartComponent {...widget} />;
      break;

    default:
      console.warn(`[WidgetRenderer] Unknown widget type: ${widget.type}`);
      rendered = (
        <div style={{ padding: '8px', background: '#fee', border: '1px solid #fcc', borderRadius: '4px' }}>
          Unknown widget type: {widget.type}
        </div>
      );
      break;
  }

  if (!rendered) {
    return null;
  }

  if (context && Object.keys(context).length > 0) {
    return <WidgetContextProvider.Provider value={context}>{rendered}</WidgetContextProvider.Provider>;
  }

  return rendered;
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

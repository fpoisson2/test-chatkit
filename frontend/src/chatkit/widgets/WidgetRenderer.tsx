import React, { Fragment, useMemo } from 'react';
import type {
  BadgeWidget,
  BoxWidget,
  ButtonWidget,
  CaptionWidget,
  CardWidget,
  CheckboxWidget,
  ColWidget,
  DatePickerWidget,
  DividerWidget,
  FormWidget,
  IconWidget,
  ImageWidget,
  InputWidget,
  LabelWidget,
  ListViewWidget,
  MarkdownWidget,
  RadioGroupWidget,
  RowWidget,
  SelectWidget,
  TextWidget,
  TextareaWidget,
  TitleWidget,
  TransitionWidget,
  WidgetComponent,
  WidgetRoot,
  VoiceSessionWidget,
  OutboundCallWidget,
} from '../types';
import { isRecord } from '../utils';

// Import renderers from extracted modules
import {
  renderText,
  renderTitle,
  renderCaption,
  renderMarkdown,
} from './renderers/TextRenderers';
import {
  renderCheckbox,
  renderInput,
  renderTextarea,
  renderSelect,
  renderDatePicker,
  renderLabel,
  renderRadioGroup,
  renderForm,
} from './renderers/FormRenderers';
import {
  renderCard,
  renderListView,
  renderBox,
  renderBasicRoot,
} from './renderers/LayoutRenderers';
import {
  renderBadge,
  renderButton,
  renderImage,
  renderIcon,
  renderDivider,
} from './renderers/UIRenderers';
import { VoiceSessionPanel } from './renderers/VoiceSessionPanel';
import { OutboundCallPanel } from './renderers/OutboundCallPanel';
import type { WidgetContext, WidgetNode } from './renderers/types';

// Re-export types and components for external use
export type { WidgetContext } from './renderers/types';
export { VoiceSessionPanel } from './renderers/VoiceSessionPanel';
export { OutboundCallPanel } from './renderers/OutboundCallPanel';

type BoxLike = BoxWidget | RowWidget | ColWidget | FormWidget | WidgetRoot;

const WidgetContextProvider = React.createContext<WidgetContext>({});

export const useWidgetContext = () => React.useContext(WidgetContextProvider);

const renderUnsupported = (type: string) => (
  <div className="alert alert-warning text-sm">Widget non pris en charge : {type}</div>
);

const renderChildren = (children: WidgetNode[], context: WidgetContext): React.ReactNode => (
  <>
    {children.map((child, index) => (
      <Fragment key={(child as any).key || (child as any).id || `child-${index}`}>
        {renderNode(child, context)}
      </Fragment>
    ))}
  </>
);

const renderNode = (node: WidgetNode, context: WidgetContext): React.ReactNode => {
  if (!isRecord(node) || typeof node.type !== 'string') {
    return null;
  }

  // Support relaxed casing for widget types coming from templates or stored definitions
  const type = node.type;
  const normalizedType = type.toLowerCase();
  let resolvedType = type;
  if (normalizedType === 'voice_session' || normalizedType === 'voicesession' || normalizedType === 'voice') {
    resolvedType = 'VoiceSession';
  } else if (normalizedType === 'outbound_call' || normalizedType === 'outboundcall') {
    resolvedType = 'OutboundCall';
  }

  switch (resolvedType) {
    case 'Card':
      return renderCard(node as CardWidget, context, renderChildren);
    case 'Basic':
      return renderBasicRoot(node as WidgetRoot, context, renderChildren);
    case 'ListView':
      return renderListView(node as ListViewWidget, context, renderChildren);
    case 'Row':
    case 'Col':
    case 'Box':
      return renderBox(node as BoxLike & { children?: unknown[] }, context, renderChildren);
    case 'VoiceSession':
      return <VoiceSessionPanel widget={node as VoiceSessionWidget} context={context} />;
    case 'OutboundCall':
      return <OutboundCallPanel widget={node as OutboundCallWidget} context={context} />;
    case 'Form':
      return renderForm(node as FormWidget, context, renderChildren);
    case 'Text':
      return renderText(node as TextWidget);
    case 'Title':
      return renderTitle(node as TitleWidget);
    case 'Caption':
      return renderCaption(node as CaptionWidget);
    case 'Badge':
      return renderBadge(node as BadgeWidget);
    case 'Markdown':
      return renderMarkdown(node as MarkdownWidget);
    case 'Button':
      return renderButton(node as ButtonWidget, context);
    case 'Image':
      return renderImage(node as ImageWidget);
    case 'Icon':
      return renderIcon(node as IconWidget);
    case 'Divider':
      return renderDivider(node as DividerWidget);
    case 'Checkbox':
      return renderCheckbox(node as CheckboxWidget, context);
    case 'Input':
      return renderInput(node as InputWidget);
    case 'Textarea':
      return renderTextarea(node as TextareaWidget);
    case 'Select':
      return renderSelect(node as SelectWidget, context);
    case 'DatePicker':
      return renderDatePicker(node as DatePickerWidget, context);
    case 'Label':
      return renderLabel(node as LabelWidget);
    case 'RadioGroup':
      return renderRadioGroup(node as RadioGroupWidget, context);
    case 'Transition':
      return renderNode((node as TransitionWidget).children as WidgetNode, context);
    case 'Spacer':
      return <div className="h-4" />;
    case 'Chart':
      return <div className="alert alert-info text-sm">Les graphiques ne sont pas pris en charge en prévisualisation.</div>;
    default:
      return renderUnsupported(type);
  }
};

const normalizeDefinition = (definition: Record<string, unknown>): WidgetRoot | null => {
  if (!isRecord(definition) || typeof definition.type !== 'string') {
    return null;
  }
  return definition as WidgetRoot;
};

export interface WidgetRendererProps {
  widget: WidgetComponent | WidgetRoot;
  context?: WidgetContext;
}

export function WidgetRenderer({ widget, context = {} }: WidgetRendererProps): JSX.Element | null {
  const normalized = useMemo(() => normalizeDefinition(widget as Record<string, unknown>), [widget]);
  const contextValue = useMemo(() => context, [context]);

  if (!normalized) {
    return null;
  }

  return (
    <WidgetContextProvider.Provider value={contextValue}>
      {renderNode(normalized, contextValue) as JSX.Element}
    </WidgetContextProvider.Provider>
  );
}

export interface WidgetListRendererProps {
  widgets: (WidgetComponent | WidgetRoot)[];
  context?: WidgetContext;
}

export function WidgetListRenderer({ widgets, context = {} }: WidgetListRendererProps): JSX.Element {
  const contextValue = useMemo(() => context, [context]);
  return (
    <WidgetContextProvider.Provider value={contextValue}>
      <div className="widget-list">
        {widgets.map((child, index) => (
          <Fragment key={child.key || child.id || `widget-${index}`}>
            {renderNode(child, contextValue)}
          </Fragment>
        ))}
      </div>
    </WidgetContextProvider.Provider>
  );
}

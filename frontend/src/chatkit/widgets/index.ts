/**
 * Exports pour les composants widgets
 */

// Composants de texte
export { TextComponent } from './Text';
export { TitleComponent } from './Title';
export { CaptionComponent } from './Caption';
export { MarkdownComponent } from './Markdown';

// Composants de layout
export { BoxComponent, resolveBoxBaseStyle } from './Box';
export { RowComponent } from './Row';
export { ColComponent } from './Col';
export { CardComponent } from './Card';

// Composants simples
export {
  BadgeComponent,
  DividerComponent,
  SpacerComponent,
  IconComponent,
  ImageComponent,
  ListViewItemComponent as ListViewItem,
  ListViewComponent as ListView,
} from './SimpleWidgets';

// Composants de formulaires
export {
  ButtonComponent as Button,
  InputComponent as Input,
  TextareaComponent as Textarea,
  SelectComponent as Select,
  CheckboxComponent as Checkbox,
  RadioGroupComponent as RadioGroup,
  DatePickerComponent as DatePicker,
  LabelComponent as Label,
  FormComponent as Form,
  TransitionComponent as Transition,
  ChartComponent as Chart,
} from './FormWidgets';

// Renderer
export { WidgetRenderer, WidgetListRenderer, VoiceSessionPanel as VoiceSessionComponent, useWidgetContext } from './WidgetRenderer';
export type { WidgetRendererProps, WidgetListRendererProps, WidgetContext } from './WidgetRenderer';

// Utils
export {
  resolveColor,
  resolveSpacingValue,
  resolveSpacing,
  resolveMargin,
  resolveBorder,
} from './utils';

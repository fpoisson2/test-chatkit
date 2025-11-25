/**
 * Types pour les widgets ChatKit
 */

import type {
  ThemeColor,
  Spacing,
  Border,
  Borders,
  EditableProps,
  RadiusValue,
  TextAlign,
  TextSize,
  IconSize,
  TitleSize,
  CaptionSize,
  Alignment,
  Justification,
  ControlVariant,
  ControlSize,
  WidgetIcon,
} from './base';
import type { ActionConfig } from './actions';

// ===== Types de base des widgets =====

export type WidgetStatus = {
  text: string;
  favicon?: string;
  frame?: boolean;
  icon?: WidgetIcon;
};

export interface WidgetComponentBase {
  key?: string;
  id?: string;
  type: string;
}

// ===== Widgets de texte =====

export interface TextWidget extends WidgetComponentBase {
  type: 'Text';
  value: string;
  streaming?: boolean;
  italic?: boolean;
  lineThrough?: boolean;
  color?: string | ThemeColor;
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  width?: number | string;
  size?: TextSize;
  textAlign?: TextAlign;
  truncate?: boolean;
  minLines?: number;
  maxLines?: number;
  editable?: false | EditableProps;
}

export interface TitleWidget extends WidgetComponentBase {
  type: 'Title';
  value: string;
  color?: string | ThemeColor;
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  size?: TitleSize;
  textAlign?: TextAlign;
  truncate?: boolean;
  maxLines?: number;
}

export interface CaptionWidget extends WidgetComponentBase {
  type: 'Caption';
  value: string;
  color?: string | ThemeColor;
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  size?: CaptionSize;
  textAlign?: TextAlign;
  truncate?: boolean;
  maxLines?: number;
}

export interface MarkdownWidget extends WidgetComponentBase {
  type: 'Markdown';
  value: string;
  streaming?: boolean;
}

export interface BadgeWidget extends WidgetComponentBase {
  type: 'Badge';
  label: string;
  color?: 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'discovery';
  variant?: 'solid' | 'soft' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  pill?: boolean;
}

export interface LabelWidget extends WidgetComponentBase {
  type: 'Label';
  value: string;
  fieldName: string;
  size?: TextSize;
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  textAlign?: TextAlign;
  color?: string | ThemeColor;
}

// ===== Widgets de layout =====

export interface BoxBase {
  children?: WidgetComponent[];
  align?: Alignment;
  justify?: Justification;
  wrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  flex?: number | string;
  gap?: number | string;
  height?: number | string;
  width?: number | string;
  size?: number | string;
  minHeight?: number | string;
  minWidth?: number | string;
  minSize?: number | string;
  maxHeight?: number | string;
  maxWidth?: number | string;
  maxSize?: number | string;
  padding?: number | string | Spacing;
  margin?: number | string | Spacing;
  border?: number | Border | Borders;
  radius?: RadiusValue;
  background?: string | ThemeColor;
  aspectRatio?: number | string;
}

export interface BoxWidget extends WidgetComponentBase, BoxBase {
  type: 'Box';
  direction?: 'row' | 'col';
}

export interface RowWidget extends WidgetComponentBase, BoxBase {
  type: 'Row';
}

export interface ColWidget extends WidgetComponentBase, BoxBase {
  type: 'Col';
}

export interface FormWidget extends WidgetComponentBase, BoxBase {
  type: 'Form';
  onSubmitAction?: ActionConfig;
  direction?: 'row' | 'col';
}

export interface DividerWidget extends WidgetComponentBase {
  type: 'Divider';
  color?: string | ThemeColor;
  size?: number | string;
  spacing?: number | string;
  flush?: boolean;
}

export interface SpacerWidget extends WidgetComponentBase {
  type: 'Spacer';
  minSize?: number | string;
}

// ===== Widgets visuels =====

export interface IconWidget extends WidgetComponentBase {
  type: 'Icon';
  name: WidgetIcon;
  color?: string | ThemeColor;
  size?: IconSize;
}

export interface ImageWidget extends WidgetComponentBase {
  type: 'Image';
  src: string;
  alt?: string;
  fit?: 'cover' | 'contain' | 'fill' | 'scale-down' | 'none';
  position?: 'top left' | 'top' | 'top right' | 'left' | 'center' | 'right' | 'bottom left' | 'bottom' | 'bottom right';
  radius?: RadiusValue;
  frame?: boolean;
  flush?: boolean;
  height?: number | string;
  width?: number | string;
  size?: number | string;
  minHeight?: number | string;
  minWidth?: number | string;
  minSize?: number | string;
  maxHeight?: number | string;
  maxWidth?: number | string;
  maxSize?: number | string;
  margin?: number | string | Spacing;
  background?: string | ThemeColor;
  aspectRatio?: number | string;
  flex?: number | string;
}

// ===== Widgets interactifs =====

export interface ButtonWidget extends WidgetComponentBase {
  type: 'Button';
  submit?: boolean;
  label?: string;
  onClickAction?: ActionConfig;
  iconStart?: WidgetIcon;
  iconEnd?: WidgetIcon;
  style?: 'primary' | 'secondary';
  iconSize?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  color?: 'primary' | 'secondary' | 'info' | 'discovery' | 'success' | 'caution' | 'warning' | 'danger';
  variant?: ControlVariant;
  size?: ControlSize;
  pill?: boolean;
  uniform?: boolean;
  block?: boolean;
  disabled?: boolean;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  description?: string;
}

export interface SelectWidget extends WidgetComponentBase {
  type: 'Select';
  name: string;
  options: SelectOption[];
  onChangeAction?: ActionConfig;
  placeholder?: string;
  defaultValue?: string;
  variant?: ControlVariant;
  size?: ControlSize;
  pill?: boolean;
  block?: boolean;
  clearable?: boolean;
  disabled?: boolean;
}

export interface DatePickerWidget extends WidgetComponentBase {
  type: 'DatePicker';
  name: string;
  onChangeAction?: ActionConfig;
  placeholder?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  variant?: ControlVariant;
  size?: ControlSize;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  pill?: boolean;
  block?: boolean;
  clearable?: boolean;
  disabled?: boolean;
}

export interface CheckboxWidget extends WidgetComponentBase {
  type: 'Checkbox';
  name: string;
  label?: string;
  defaultChecked?: string;
  onChangeAction?: ActionConfig;
  disabled?: boolean;
  required?: boolean;
}

export interface InputWidget extends WidgetComponentBase {
  type: 'Input';
  name: string;
  inputType?: 'number' | 'email' | 'text' | 'password' | 'tel' | 'url';
  defaultValue?: string;
  required?: boolean;
  pattern?: string;
  placeholder?: string;
  allowAutofillExtensions?: boolean;
  autoSelect?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  variant?: 'soft' | 'outline';
  size?: ControlSize;
  gutterSize?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  pill?: boolean;
}

export interface RadioOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface RadioGroupWidget extends WidgetComponentBase {
  type: 'RadioGroup';
  name: string;
  options?: RadioOption[];
  ariaLabel?: string;
  onChangeAction?: ActionConfig;
  defaultValue?: string;
  direction?: 'row' | 'col';
  disabled?: boolean;
  required?: boolean;
}

export interface TextareaWidget extends WidgetComponentBase {
  type: 'Textarea';
  name: string;
  defaultValue?: string;
  required?: boolean;
  pattern?: string;
  placeholder?: string;
  autoSelect?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  variant?: 'soft' | 'outline';
  size?: ControlSize;
  gutterSize?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  rows?: number;
  autoResize?: boolean;
  maxRows?: number;
  allowAutofillExtensions?: boolean;
}

export interface TransitionWidget extends WidgetComponentBase {
  type: 'Transition';
  children?: WidgetComponent;
}

// ===== Widgets de données =====

export type CurveType = 'basis' | 'basisClosed' | 'basisOpen' | 'bumpX' | 'bumpY' | 'bump'
  | 'linear' | 'linearClosed' | 'natural' | 'monotoneX' | 'monotoneY' | 'monotone'
  | 'step' | 'stepBefore' | 'stepAfter';

export interface BarSeries {
  type: 'bar';
  label?: string;
  dataKey: string;
  stack?: string;
  color?: string | ThemeColor;
}

export interface AreaSeries {
  type: 'area';
  label?: string;
  dataKey: string;
  stack?: string;
  color?: string | ThemeColor;
  curveType?: CurveType;
}

export interface LineSeries {
  type: 'line';
  label?: string;
  dataKey: string;
  color?: string | ThemeColor;
  curveType?: CurveType;
}

export type Series = BarSeries | AreaSeries | LineSeries;

export interface XAxisConfig {
  dataKey: string;
  hide?: boolean;
  labels?: Record<string, string>;
}

export interface ChartWidget extends WidgetComponentBase {
  type: 'Chart';
  data: Array<Record<string, string | number>>;
  series: Series[];
  xAxis: string | XAxisConfig;
  showYAxis?: boolean;
  showLegend?: boolean;
  showTooltip?: boolean;
  barGap?: number;
  barCategoryGap?: number;
  flex?: number | string;
  height?: number | string;
  width?: number | string;
  size?: number | string;
  minHeight?: number | string;
  minWidth?: number | string;
  minSize?: number | string;
  maxHeight?: number | string;
  maxWidth?: number | string;
  maxSize?: number | string;
  aspectRatio?: number | string;
}

// ===== Widgets de liste =====

export interface ListViewItem extends WidgetComponentBase {
  type: 'ListViewItem';
  children: WidgetComponent[];
  onClickAction?: ActionConfig;
  gap?: number | string;
  align?: Alignment;
}

export interface ListView extends WidgetComponentBase {
  type: 'ListView';
  children: ListViewItem[];
  limit?: number | 'auto';
  status?: WidgetStatus;
  theme?: 'light' | 'dark';
}

// ===== Widgets de carte =====

export interface CardAction {
  label: string;
  action: ActionConfig;
}

export interface Card extends WidgetComponentBase {
  type: 'Card';
  asForm?: boolean;
  children: WidgetComponent[];
  background?: string | ThemeColor;
  size?: 'sm' | 'md' | 'lg' | 'full';
  padding?: number | string | Spacing;
  status?: WidgetStatus;
  collapsed?: boolean;
  confirm?: CardAction;
  cancel?: CardAction;
  theme?: 'light' | 'dark';
}

// ===== Widgets voix =====

export interface VoiceSessionWidget extends WidgetComponentBase {
  type: 'VoiceSession';
  title?: string;
  description?: string;
  startLabel?: string;
  stopLabel?: string;
  showTranscripts?: boolean;
}

export interface OutboundCallWidget extends WidgetComponentBase {
  type: 'OutboundCall';
  title?: string;
  description?: string;
  toNumber?: string;
  hangupLabel?: string;
  showTranscripts?: boolean;
  showAudioPlayer?: boolean;
}

// ===== Types union des widgets =====

export type WidgetComponent =
  | TextWidget
  | TitleWidget
  | CaptionWidget
  | ChartWidget
  | BadgeWidget
  | MarkdownWidget
  | BoxWidget
  | RowWidget
  | ColWidget
  | DividerWidget
  | IconWidget
  | ImageWidget
  | ListViewItem
  | ButtonWidget
  | CheckboxWidget
  | SpacerWidget
  | SelectWidget
  | DatePickerWidget
  | FormWidget
  | InputWidget
  | LabelWidget
  | RadioGroupWidget
  | TextareaWidget
  | TransitionWidget
  | VoiceSessionWidget
  | OutboundCallWidget;

export type WidgetRoot = Card | ListView;

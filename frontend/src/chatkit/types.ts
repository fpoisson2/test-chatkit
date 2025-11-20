/**
 * Types pour le module ChatKit React personnalisé
 * Ces types correspondent aux types Python dans chatkit-python
 */

// ===== Types de base =====

export type ThemeColor = {
  dark: string;
  light: string;
};

export type Spacing = {
  top?: number | string;
  right?: number | string;
  bottom?: number | string;
  left?: number | string;
  x?: number | string;
  y?: number | string;
};

export type Border = {
  size: number;
  color?: string | ThemeColor;
  style?: 'solid' | 'dashed' | 'dotted' | 'double' | 'groove' | 'ridge' | 'inset' | 'outset';
};

export type Borders = {
  top?: number | Border;
  right?: number | Border;
  bottom?: number | Border;
  left?: number | Border;
  x?: number | Border;
  y?: number | Border;
};

export type EditableProps = {
  name: string;
  autoFocus?: boolean;
  autoSelect?: boolean;
  autoComplete?: string;
  allowAutofillExtensions?: boolean;
  pattern?: string;
  placeholder?: string;
  required?: boolean;
};

export type RadiusValue = '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full' | '100%' | 'none';
export type TextAlign = 'start' | 'center' | 'end';
export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
export type TitleSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';
export type CaptionSize = 'sm' | 'md' | 'lg';
export type Alignment = 'start' | 'center' | 'end' | 'baseline' | 'stretch';
export type Justification = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly' | 'stretch';
export type ControlVariant = 'solid' | 'soft' | 'outline' | 'ghost';
export type ControlSize = '3xs' | '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

export type WidgetIcon =
  | 'agent' | 'analytics' | 'atom' | 'bolt' | 'book-open' | 'book-clock' | 'book-closed'
  | 'calendar' | 'chart' | 'check' | 'check-circle' | 'check-circle-filled'
  | 'chevron-left' | 'chevron-right' | 'circle-question' | 'compass' | 'confetti'
  | 'cube' | 'desktop' | 'document' | 'dot' | 'dots-horizontal' | 'dots-vertical'
  | 'empty-circle' | 'external-link' | 'globe' | 'keys' | 'lab' | 'images' | 'info'
  | 'lifesaver' | 'lightbulb' | 'mail' | 'map-pin' | 'maps' | 'mobile' | 'name'
  | 'notebook' | 'notebook-pencil' | 'page-blank' | 'phone' | 'play' | 'plus'
  | 'profile' | 'profile-card' | 'reload' | 'star' | 'star-filled' | 'search'
  | 'sparkle' | 'sparkle-double' | 'square-code' | 'square-image' | 'square-text'
  | 'suitcase' | 'settings-slider' | 'user' | 'wreath' | 'write' | 'write-alt' | 'write-alt2';

// ===== Types d'actions =====

export type ActionConfig = {
  type: string;
  [key: string]: unknown;
};

// ===== Types de widgets =====

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

export interface SpacerWidget extends WidgetComponentBase {
  type: 'Spacer';
  minSize?: number | string;
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

export interface LabelWidget extends WidgetComponentBase {
  type: 'Label';
  value: string;
  fieldName: string;
  size?: TextSize;
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  textAlign?: TextAlign;
  color?: string | ThemeColor;
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
  | TransitionWidget;

export type WidgetRoot = Card | ListView;

// ===== Types pour les threads et messages =====

export interface UserMessageTextContent {
  type: 'text';
  text: string;
}

export interface UserMessageImageContent {
  type: 'image';
  image: string;
}

export interface UserMessageFileContent {
  type: 'file';
  file: string;
}

export type UserMessageContent = UserMessageTextContent | UserMessageImageContent | UserMessageFileContent;

export interface UserMessageItem {
  type: 'user_message';
  id: string;
  content: UserMessageContent[];
  created_at: string;
}

export interface AssistantMessageTextContent {
  type: 'text';
  text: string;
}

export interface AssistantMessageWidgetContent {
  type: 'widget';
  widget: WidgetRoot;
}

export type AssistantMessageContent = AssistantMessageTextContent | AssistantMessageWidgetContent;

export interface AssistantMessageItem {
  type: 'assistant_message';
  id: string;
  content: AssistantMessageContent[];
  created_at: string;
  status?: 'in_progress' | 'completed' | 'failed';
}

export type ThreadItem = UserMessageItem | AssistantMessageItem;

export interface Thread {
  id: string;
  items: ThreadItem[];
  metadata?: Record<string, unknown>;
}

// ===== Types pour les événements de streaming =====

export interface ThreadStreamEventBase {
  type: string;
  event_id: string;
}

export interface ThreadCreatedEvent extends ThreadStreamEventBase {
  type: 'thread.created';
  thread: Thread;
}

export interface ThreadItemCreatedEvent extends ThreadStreamEventBase {
  type: 'thread.item.created';
  item: ThreadItem;
}

export interface ThreadItemDeltaEvent extends ThreadStreamEventBase {
  type: 'thread.item.delta';
  delta: {
    item_id: string;
    content_index: number;
    type: 'text' | 'widget';
    text?: string;
    widget?: Partial<WidgetRoot>;
  };
}

export interface ThreadItemCompletedEvent extends ThreadStreamEventBase {
  type: 'thread.item.completed';
  item: ThreadItem;
}

export interface ThreadMessageCompletedEvent extends ThreadStreamEventBase {
  type: 'thread.message.completed';
  message: AssistantMessageItem;
}

export interface ErrorEvent extends ThreadStreamEventBase {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

export type ThreadStreamEvent =
  | ThreadCreatedEvent
  | ThreadItemCreatedEvent
  | ThreadItemDeltaEvent
  | ThreadItemCompletedEvent
  | ThreadMessageCompletedEvent
  | ErrorEvent;

// ===== Configuration ChatKit =====

export interface ChatKitAPIConfig {
  url: string;
  headers?: Record<string, string>;
  dangerouslyAllowBrowser?: boolean;
}

export interface StartScreenPrompt {
  label: string;
  prompt: string;
  icon?: WidgetIcon;
}

export interface ChatKitOptions {
  api: ChatKitAPIConfig;
  initialThread?: string | null;
  header?: {
    enabled?: boolean;
    leftAction?: {
      icon: string;
      onClick: () => void;
    };
  };
  history?: {
    enabled?: boolean;
  };
  theme?: {
    colorScheme?: 'light' | 'dark';
    radius?: RadiusValue;
    density?: 'compact' | 'normal' | 'comfortable';
    color?: {
      accent?: {
        primary?: string;
        level?: number;
      };
      surface?: {
        background?: string;
        foreground?: string;
      };
    };
    typography?: {
      baseSize?: number;
      fontFamily?: string;
      fontFamilyMono?: string;
    };
  };
  startScreen?: {
    greeting?: string;
    prompts?: StartScreenPrompt[];
  };
  disclaimer?: {
    text: string;
  };
  composer?: {
    placeholder?: string;
    attachments?: {
      enabled: boolean;
      maxCount?: number;
      maxSize?: number;
      accept?: Record<string, string[]>;
    };
  };
  onClientTool?: (toolCall: { name: string; params: unknown }) => Promise<unknown>;
  onError?: (error: { error: Error }) => void;
  onResponseStart?: () => void;
  onResponseEnd?: () => void;
  onThreadChange?: (event: { threadId: string | null }) => void;
  onThreadLoadStart?: (event: { threadId: string }) => void;
  onThreadLoadEnd?: (event: { threadId: string }) => void;
  onLog?: (entry: { name: string; data?: Record<string, unknown> }) => void;
}

export interface ChatKitControl {
  thread: Thread | null;
  isLoading: boolean;
  error: Error | null;
  sendMessage: (content: UserMessageContent[] | string) => Promise<void>;
  refresh: () => Promise<void>;
}

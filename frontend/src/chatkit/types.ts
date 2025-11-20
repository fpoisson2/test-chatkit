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
  type: 'input_text';
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

export interface UserMessageTagContent {
  type: 'input_tag';
  id: string;
  text: string;
  data: Record<string, unknown>;
  interactive?: boolean;
}

export type UserMessageContent = UserMessageTextContent | UserMessageImageContent | UserMessageFileContent | UserMessageTagContent;

export interface UserMessageItem {
  type: 'user_message';
  id: string;
  content: UserMessageContent[];
  created_at: string;
  attachments?: string[];
  quoted_text?: string;
}

// ===== Types pour les sources =====

export interface SourceBase {
  title: string;
  description?: string;
  timestamp?: string;
  group?: string;
}

export interface URLSource extends SourceBase {
  type: 'url';
  url: string;
  attribution?: string;
}

export interface FileSource extends SourceBase {
  type: 'file';
  filename: string;
}

export interface EntitySource extends SourceBase {
  type: 'entity';
  id: string;
  icon?: string;
  preview?: 'lazy';
  data?: Record<string, unknown>;
}

export type Source = URLSource | FileSource | EntitySource;

// ===== Types pour les annotations =====

export interface Annotation {
  type: 'annotation';
  source: Source;
  index?: number;
}

// ===== Types pour le contenu assistant =====

export interface AssistantMessageTextContent {
  type: 'output_text';
  text: string;
  annotations?: Annotation[];
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
  reasoning_id?: string;
}

export interface ClientToolCallItem {
  type: 'client_tool_call';
  id: string;
  created_at: string;
  thread_id: string;
  status: 'pending' | 'completed';
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
  output?: unknown;
}

// ===== Types pour les tasks =====

export interface BaseTask {
  status_indicator?: 'none' | 'loading' | 'complete';
}

export interface CustomTask extends BaseTask {
  type: 'custom';
  title?: string;
  icon?: string;
  content?: string;
}

export interface SearchTask extends BaseTask {
  type: 'web_search';
  title?: string;
  title_query?: string;
  queries?: string[];
  sources?: URLSource[];
}

export interface ThoughtTask extends BaseTask {
  type: 'thought';
  title?: string;
  content: string;
}

export interface FileTask extends BaseTask {
  type: 'file';
  title?: string;
  sources?: FileSource[];
}

export interface GeneratedImage {
  id: string;
  b64_json?: string;
  data_url?: string;
  image_url?: string;
  output_format?: 'png' | 'webp' | 'jpeg' | 'auto';
  background?: 'transparent' | 'opaque' | 'auto';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  partials?: string[];
}

export interface ImageTask extends BaseTask {
  type: 'image';
  title?: string;
  images?: GeneratedImage[];
  call_id?: string;
  output_index?: number;
}

export type Task = CustomTask | SearchTask | ThoughtTask | FileTask | ImageTask;

// ===== Types pour les workflows =====

export interface CustomSummary {
  title: string;
  icon?: string;
}

export interface DurationSummary {
  duration: number;
}

export type WorkflowSummary = CustomSummary | DurationSummary;

export interface Workflow {
  type: 'custom' | 'reasoning';
  tasks: Task[];
  summary?: WorkflowSummary;
  expanded?: boolean;
  completed?: boolean;
}

// ===== Types pour les items de thread =====

export interface WidgetItem {
  type: 'widget';
  id: string;
  created_at: string;
  widget: WidgetRoot;
  copy_text?: string;
}

export interface TaskItem {
  type: 'task';
  id: string;
  created_at: string;
  task: Task;
}

export interface WorkflowItem {
  type: 'workflow';
  id: string;
  created_at: string;
  workflow: Workflow;
}

export interface EndOfTurnItem {
  type: 'end_of_turn';
  id: string;
  created_at: string;
}

export type ThreadItem =
  | UserMessageItem
  | AssistantMessageItem
  | ClientToolCallItem
  | WidgetItem
  | TaskItem
  | WorkflowItem
  | EndOfTurnItem;

export interface Thread {
  id: string;
  title?: string;
  items: ThreadItem[];
  metadata?: Record<string, unknown>;
}

// ===== Types pour les listes paginées =====

export interface ListThreadsOptions {
  limit?: number;
  order?: 'asc' | 'desc';
  after?: string;
}

export interface ThreadListResponse {
  data: Thread[];
  has_more: boolean;
  after?: string;
}

export interface ListItemsOptions {
  limit?: number;
  order?: 'asc' | 'desc';
  after?: string;
  before?: string;
}

export interface ItemListResponse {
  data: ThreadItem[];
  has_more: boolean;
  after?: string;
}

// ===== Types pour les événements de streaming =====

export interface ThreadStreamEventBase {
  type: string;
  event_id: string;
}

// Événements de thread principaux
export interface ThreadCreatedEvent extends ThreadStreamEventBase {
  type: 'thread.created';
  thread: Thread;
}

export interface ThreadUpdatedEvent extends ThreadStreamEventBase {
  type: 'thread.updated';
  thread: Thread;
}

// Événements d'items de thread
export interface ThreadItemAddedEvent extends ThreadStreamEventBase {
  type: 'thread.item.added';
  item: ThreadItem;
}

export interface ThreadItemDoneEvent extends ThreadStreamEventBase {
  type: 'thread.item.done';
  item: ThreadItem;
}

export interface ThreadItemRemovedEvent extends ThreadStreamEventBase {
  type: 'thread.item.removed';
  item_id: string;
}

export interface ThreadItemReplacedEvent extends ThreadStreamEventBase {
  type: 'thread.item.replaced';
  item: ThreadItem;
}

// Union des types d'updates d'items
export type ThreadItemUpdate =
  | AssistantMessageContentPartAddedEvent
  | AssistantMessageContentPartTextDeltaEvent
  | AssistantMessageContentPartAnnotationAddedEvent
  | AssistantMessageContentPartDoneEvent
  | WidgetStreamingTextValueDeltaEvent
  | WidgetComponentUpdatedEvent
  | WidgetRootUpdatedEvent
  | WorkflowTaskAddedEvent
  | WorkflowTaskUpdatedEvent;

export interface ThreadItemUpdatedEvent extends ThreadStreamEventBase {
  type: 'thread.item.updated';
  item_id: string;
  update: ThreadItemUpdate;
}

// Événements de contenu assistant (plus granulaires)
export interface AssistantMessageContentPartAddedEvent extends ThreadStreamEventBase {
  type: 'assistant_message.content_part.added';
  item_id: string;
  content_index: number;
  content: AssistantMessageContent;
}

export interface AssistantMessageContentPartTextDeltaEvent extends ThreadStreamEventBase {
  type: 'assistant_message.content_part.text_delta';
  item_id: string;
  content_index: number;
  delta: string;
}

export interface AssistantMessageContentPartAnnotationAddedEvent extends ThreadStreamEventBase {
  type: 'assistant_message.content_part.annotation_added';
  item_id: string;
  content_index: number;
  annotation_index: number;
  annotation: Annotation;
}

export interface AssistantMessageContentPartDoneEvent extends ThreadStreamEventBase {
  type: 'assistant_message.content_part.done';
  item_id: string;
  content_index: number;
  content: AssistantMessageContent;
}

// Événements UI/UX
export interface ProgressUpdateEvent extends ThreadStreamEventBase {
  type: 'progress_update';
  icon?: string;
  text: string;
}

export interface NoticeEvent extends ThreadStreamEventBase {
  type: 'notice';
  level: 'info' | 'warning' | 'danger';
  message: string;
  title?: string;
}

// Événements d'erreur
export interface ErrorEvent extends ThreadStreamEventBase {
  type: 'error';
  code: string;
  message: string;
  allow_retry?: boolean;
}

// LEGACY: événements conservés pour compatibilité mais deprecated
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

// Événements de workflow
export interface WorkflowTaskAddedEvent extends ThreadStreamEventBase {
  type: 'workflow.task.added';
  item_id: string;
  task_index: number;
  task: Task;
}

export interface WorkflowTaskUpdatedEvent extends ThreadStreamEventBase {
  type: 'workflow.task.updated';
  item_id: string;
  task_index: number;
  task: Task;
}

// Événements de widget
export interface WidgetRootUpdatedEvent extends ThreadStreamEventBase {
  type: 'widget.root.updated';
  item_id: string;
  widget: WidgetRoot;
}

export interface WidgetComponentUpdatedEvent extends ThreadStreamEventBase {
  type: 'widget.component.updated';
  item_id: string;
  component_id: string;
  component: WidgetComponent;
}

export interface WidgetStreamingTextValueDeltaEvent extends ThreadStreamEventBase {
  type: 'widget.streaming_text.value_delta';
  item_id: string;
  component_id: string;
  delta: string;
  done: boolean;
}

export type ThreadStreamEvent =
  | ThreadCreatedEvent
  | ThreadUpdatedEvent
  | ThreadItemAddedEvent
  | ThreadItemDoneEvent
  | ThreadItemUpdatedEvent
  | ThreadItemRemovedEvent
  | ThreadItemReplacedEvent
  | ProgressUpdateEvent
  | ErrorEvent
  | NoticeEvent
  // Legacy events (conservés pour compatibilité)
  | ThreadItemCreatedEvent
  | ThreadItemDeltaEvent
  | ThreadItemCompletedEvent
  | ThreadMessageCompletedEvent
  // Les events individuels sont aussi exportés directement
  | AssistantMessageContentPartAddedEvent
  | AssistantMessageContentPartTextDeltaEvent
  | AssistantMessageContentPartAnnotationAddedEvent
  | AssistantMessageContentPartDoneEvent
  | WorkflowTaskAddedEvent
  | WorkflowTaskUpdatedEvent
  | WidgetRootUpdatedEvent
  | WidgetComponentUpdatedEvent
  | WidgetStreamingTextValueDeltaEvent;

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

// ===== Types pour les actions et inférences =====

export interface Action<T extends string = string, D = unknown> {
  type: T;
  data?: D;
}

export interface InferenceOptions {
  tool_choice?: ToolChoice;
  model?: string;
}

export interface ToolChoice {
  id: string;
}

export type FeedbackKind = 'positive' | 'negative';

// ===== Control ChatKit =====

export interface ChatKitControl {
  thread: Thread | null;
  isLoading: boolean;
  error: Error | null;
  sendMessage: (content: UserMessageContent[] | string, options?: { inferenceOptions?: InferenceOptions }) => Promise<void>;
  refresh: () => Promise<void>;
  customAction: (itemId: string | null, action: Action) => Promise<void>;
  retryAfterItem: (itemId: string) => Promise<void>;
  submitFeedback: (itemIds: string[], kind: FeedbackKind) => Promise<void>;
  updateThreadMetadata: (metadata: Record<string, unknown>) => Promise<void>;
}

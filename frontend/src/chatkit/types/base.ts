/**
 * Types de base pour le module ChatKit
 */

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

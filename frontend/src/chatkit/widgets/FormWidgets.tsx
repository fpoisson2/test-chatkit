/**
 * Composants de formulaires
 */
import React from 'react';
import type {
  ButtonWidget,
  InputWidget,
  TextareaWidget,
  SelectWidget,
  CheckboxWidget,
  RadioGroupWidget,
  DatePickerWidget,
  LabelWidget,
  FormWidget,
  TransitionWidget,
  ChartWidget,
} from '../types';
import { resolveColor } from './utils';
import { useWidgetContext, WidgetRenderer } from './WidgetRenderer';
import { resolveBoxBaseStyle } from './Box';

export function ButtonComponent(props: ButtonWidget): JSX.Element {
  const { label, onClickAction, iconStart, iconEnd, submit, style: btnStyle = 'primary', variant = 'solid', size = 'md', pill, disabled } = props;
  const { onAction } = useWidgetContext();

  const style: React.CSSProperties = {
    padding: size === 'sm' ? '6px 12px' : size === 'lg' ? '12px 24px' : '8px 16px',
    fontSize: size === 'sm' ? '14px' : size === 'lg' ? '18px' : '16px',
    border: variant === 'outline' ? '1px solid currentColor' : 'none',
    background: variant === 'solid' ? (btnStyle === 'primary' ? '#0066ff' : '#666') : variant === 'soft' ? 'rgba(0,102,255,0.1)' : 'transparent',
    color: variant === 'solid' ? '#fff' : '#0066ff',
    borderRadius: pill ? '999px' : '6px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
  };

  const handleClick = () => {
    if (onClickAction && onAction && !disabled) {
      onAction(onClickAction);
    }
  };

  return (
    <button
      type={submit ? 'submit' : 'button'}
      className="chatkit-button"
      style={style}
      onClick={handleClick}
      disabled={disabled}
    >
      {iconStart && <span>●</span>}
      {label}
      {iconEnd && <span>●</span>}
    </button>
  );
}

export function InputComponent(props: InputWidget): JSX.Element {
  const { name, inputType = 'text', defaultValue, placeholder, required, pattern, disabled, variant = 'soft', size = 'md', pill } = props;

  const style: React.CSSProperties = {
    padding: size === 'sm' ? '6px 12px' : size === 'lg' ? '12px 16px' : '8px 12px',
    fontSize: size === 'sm' ? '14px' : size === 'lg' ? '18px' : '16px',
    border: variant === 'outline' ? '1px solid #ddd' : 'none',
    background: variant === 'soft' ? '#f5f5f5' : '#fff',
    borderRadius: pill ? '999px' : '6px',
    width: '100%',
  };

  return (
    <input
      type={inputType}
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      required={required}
      pattern={pattern}
      disabled={disabled}
      className="chatkit-input"
      style={style}
    />
  );
}

export function TextareaComponent(props: TextareaWidget): JSX.Element {
  const { name, defaultValue, placeholder, required, disabled, variant = 'soft', size = 'md', rows = 3 } = props;

  const style: React.CSSProperties = {
    padding: size === 'sm' ? '6px 12px' : size === 'lg' ? '12px 16px' : '8px 12px',
    fontSize: size === 'sm' ? '14px' : size === 'lg' ? '18px' : '16px',
    border: variant === 'outline' ? '1px solid #ddd' : 'none',
    background: variant === 'soft' ? '#f5f5f5' : '#fff',
    borderRadius: '6px',
    width: '100%',
    fontFamily: 'inherit',
  };

  return (
    <textarea
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      rows={rows}
      className="chatkit-textarea"
      style={style}
    />
  );
}

export function SelectComponent(props: SelectWidget): JSX.Element {
  const { name, options, defaultValue, placeholder, disabled, variant = 'soft', size = 'md', pill } = props;

  const style: React.CSSProperties = {
    padding: size === 'sm' ? '6px 12px' : size === 'lg' ? '12px 16px' : '8px 12px',
    fontSize: size === 'sm' ? '14px' : size === 'lg' ? '18px' : '16px',
    border: variant === 'outline' ? '1px solid #ddd' : 'none',
    background: variant === 'soft' ? '#f5f5f5' : '#fff',
    borderRadius: pill ? '999px' : '6px',
    width: '100%',
  };

  return (
    <select
      name={name}
      defaultValue={defaultValue}
      disabled={disabled}
      className="chatkit-select"
      style={style}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function CheckboxComponent(props: CheckboxWidget): JSX.Element {
  const { name, label, defaultChecked, required, disabled } = props;

  return (
    <label className="chatkit-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <input
        type="checkbox"
        name={name}
        defaultChecked={!!defaultChecked}
        required={required}
        disabled={disabled}
      />
      {label && <span>{label}</span>}
    </label>
  );
}

export function RadioGroupComponent(props: RadioGroupWidget): JSX.Element {
  const { name, options = [], defaultValue, direction = 'col', disabled, required } = props;

  return (
    <div className="chatkit-radio-group" style={{ display: 'flex', flexDirection: direction, gap: '8px' }}>
      {options.map((opt) => (
        <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: disabled || opt.disabled ? 'not-allowed' : 'pointer' }}>
          <input
            type="radio"
            name={name}
            value={opt.value}
            defaultChecked={opt.value === defaultValue}
            disabled={disabled || opt.disabled}
            required={required}
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

export function DatePickerComponent(props: DatePickerWidget): JSX.Element {
  const { name, defaultValue, placeholder, min, max, disabled, variant = 'soft', size = 'md', pill } = props;

  const style: React.CSSProperties = {
    padding: size === 'sm' ? '6px 12px' : size === 'lg' ? '12px 16px' : '8px 12px',
    fontSize: size === 'sm' ? '14px' : size === 'lg' ? '18px' : '16px',
    border: variant === 'outline' ? '1px solid #ddd' : 'none',
    background: variant === 'soft' ? '#f5f5f5' : '#fff',
    borderRadius: pill ? '999px' : '6px',
    width: '100%',
  };

  return (
    <input
      type="date"
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      min={min}
      max={max}
      disabled={disabled}
      className="chatkit-datepicker"
      style={style}
    />
  );
}

export function LabelComponent(props: LabelWidget): JSX.Element {
  const { value, fieldName, size = 'md', weight, textAlign, color } = props;

  const style: React.CSSProperties = {
    fontSize: `var(--text-size-${size})`,
    fontWeight: weight,
    textAlign,
    color: resolveColor(color),
    display: 'block',
    marginBottom: '4px',
  };

  return (
    <label htmlFor={fieldName} className="chatkit-label" style={style}>
      {value}
    </label>
  );
}

export function FormComponent(props: FormWidget): JSX.Element {
  const { children, onSubmitAction, direction = 'col' } = props;
  const { onAction, onFormData } = useWidgetContext();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    if (onSubmitAction && onAction) {
      onAction(onSubmitAction);
    }

    if (onFormData) {
      onFormData(formData);
    }
  };

  const style: React.CSSProperties = {
    ...resolveBoxBaseStyle(props),
    flexDirection: direction,
  };

  return (
    <form className="chatkit-form" style={style} onSubmit={handleSubmit}>
      {children?.map((child, index) => (
        <WidgetRenderer key={child.key || child.id || `child-${index}`} widget={child} />
      ))}
    </form>
  );
}

export function TransitionComponent(props: TransitionWidget): JSX.Element {
  const { children } = props;

  if (!children) return <></>;

  return (
    <div className="chatkit-transition" style={{ transition: 'all 0.2s ease-in-out' }}>
      <WidgetRenderer widget={children} />
    </div>
  );
}

export function ChartComponent(props: ChartWidget): JSX.Element {
  // Placeholder simple pour les graphiques
  // Une vraie implémentation utiliserait une bibliothèque comme recharts
  return (
    <div className="chatkit-chart" style={{ padding: '16px', border: '1px solid #ddd', borderRadius: '8px' }}>
      <div style={{ color: '#666', fontSize: '14px' }}>Chart: {props.series.length} series</div>
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>
        Chart visualization (requires recharts or similar library)
      </div>
    </div>
  );
}

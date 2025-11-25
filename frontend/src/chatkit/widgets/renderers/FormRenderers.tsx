import React from 'react';
import type {
  CheckboxWidget,
  DatePickerWidget,
  FormWidget,
  InputWidget,
  LabelWidget,
  RadioGroupWidget,
  SelectWidget,
  TextareaWidget,
} from '../../types';
import { applyBoxStyles } from '../../utils';
import type { WidgetContext, RenderChildrenFn } from './types';

export const renderCheckbox = (component: CheckboxWidget, context: WidgetContext): JSX.Element => (
  <label className="flex items-center gap-3">
    <input
      type="checkbox"
      name={component.name}
      defaultChecked={component.defaultChecked === 'true'}
      disabled={component.disabled}
      required={component.required}
      onChange={() => component.onChangeAction && context.onAction?.(component.onChangeAction)}
    />
    <span>{component.label ?? 'Case à cocher'}</span>
  </label>
);

export const renderInput = (component: InputWidget): JSX.Element => (
  <input
    type={component.inputType ?? 'text'}
    name={component.name}
    defaultValue={component.defaultValue}
    placeholder={component.placeholder}
    required={component.required}
    pattern={component.pattern}
    disabled={component.disabled}
    className="input"
  />
);

export const renderTextarea = (component: TextareaWidget): JSX.Element => (
  <textarea
    name={component.name}
    defaultValue={component.defaultValue}
    placeholder={component.placeholder}
    required={component.required}
    disabled={component.disabled}
    rows={component.rows ?? 3}
    className="textarea"
  />
);

export const renderSelect = (component: SelectWidget, context: WidgetContext): JSX.Element => (
  <select
    name={component.name}
    defaultValue={component.defaultValue}
    disabled={component.disabled}
    className="select"
    onChange={() => component.onChangeAction && context.onAction?.(component.onChangeAction)}
  >
    {component.placeholder ? <option value="">{component.placeholder}</option> : null}
    {(component.options ?? []).map((option) => (
      <option key={option.value} value={option.value} disabled={option.disabled}>
        {option.label}
      </option>
    ))}
  </select>
);

export const renderDatePicker = (component: DatePickerWidget, context: WidgetContext): JSX.Element => (
  <input
    type="date"
    name={component.name}
    defaultValue={component.defaultValue}
    min={component.min}
    max={component.max}
    placeholder={component.placeholder}
    disabled={component.disabled}
    className="input"
    onChange={() => component.onChangeAction && context.onAction?.(component.onChangeAction)}
  />
);

export const renderLabel = (component: LabelWidget): JSX.Element => (
  <label className="form-label" htmlFor={component.name}>
    {component.label ?? component.name}
  </label>
);

export const renderRadioGroup = (component: RadioGroupWidget, context: WidgetContext): JSX.Element => (
  <div className="flex flex-col gap-2" role="radiogroup" aria-label={component.name}>
    {(component.options ?? []).map((option) => (
      <label key={option.value} className="flex items-center gap-2">
        <input
          type="radio"
          name={component.name}
          value={option.value}
          defaultChecked={option.default}
          disabled={option.disabled}
          onChange={() => component.onChangeAction && context.onAction?.(component.onChangeAction)}
        />
        <span>{option.label}</span>
      </label>
    ))}
  </div>
);

export const renderForm = (
  box: FormWidget,
  context: WidgetContext,
  renderChildren: RenderChildrenFn
): JSX.Element => {
  const styles = applyBoxStyles(box);
  return (
    <form
      className="flex flex-col gap-4"
      style={styles}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        context.onFormData?.(formData);
        if (box.onSubmitAction) {
          context.onAction?.(box.onSubmitAction);
        }
      }}
    >
      {renderChildren(Array.isArray(box.children) ? box.children : [], context)}
    </form>
  );
};

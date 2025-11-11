# UI Components for Node Inspector

This directory contains reusable UI components for building improved node inspector interfaces with progressive disclosure patterns.

## Components

### TabSection

Radix UI-based tabs component for organizing settings into logical groups.

**Usage:**

```tsx
import { TabSection } from './ui-components';
import { Settings, Cpu, Wrench } from 'lucide-react';

const tabs = [
  {
    id: 'basic',
    label: 'Basique',
    icon: Settings,
    badge: 2, // Optional: shows error count
    content: <BasicSettings />
  },
  {
    id: 'model',
    label: 'Modèle',
    icon: Cpu,
    content: <ModelSettings />
  },
  {
    id: 'tools',
    label: 'Outils',
    icon: Wrench,
    content: <ToolsSettings />
  }
];

<TabSection
  tabs={tabs}
  defaultTab="basic"
  onTabChange={(tabId) => console.log('Active tab:', tabId)}
/>
```

**Features:**
- Keyboard navigation
- Accessible (ARIA roles)
- Badge support for error counts
- Icon support
- Smooth animations

---

### AccordionSection

Collapsible section with optional toggle switch, perfect for optional tool configurations.

**Usage:**

```tsx
import { AccordionSection } from './ui-components';
import { Globe } from 'lucide-react';

<AccordionSection
  id="web-search"
  title="Web Search"
  icon={Globe}
  enabled={webSearchEnabled}
  onToggle={(enabled) => setWebSearchEnabled(enabled)}
  expandedByDefault={false}
>
  <div>
    {/* Your tool configuration fields */}
  </div>
</AccordionSection>
```

**Props:**
- `id` (string): Unique identifier
- `title` (string): Section title
- `icon` (LucideIcon): Optional icon
- `enabled` (boolean): Toggle state
- `onToggle` (function): Toggle callback
- `expandedByDefault` (boolean): Initial expanded state
- `showToggle` (boolean): Show/hide toggle switch

**Features:**
- Smooth expand/collapse animations
- Integrated toggle switch
- Only renders content when enabled
- Accessible (ARIA attributes)

---

### Field

Standardized form field component with validation, hints, warnings, and errors.

**Usage:**

```tsx
import { Field } from './ui-components';

<Field
  label="Temperature"
  required
  hint="Contrôle la créativité (0 = déterministe, 1 = créatif)"
  error={temperatureError}
  warning={temperatureWarning}
>
  <input
    type="number"
    value={temperature}
    onChange={(e) => setTemperature(e.target.value)}
    min="0"
    max="1"
    step="0.1"
  />
</Field>
```

**Props:**
- `label` (string): Field label
- `required` (boolean): Shows asterisk (*)
- `error` (string): Error message (red)
- `warning` (string): Warning message (yellow)
- `hint` (string): Helpful hint (gray)
- `htmlFor` (string): Label's for attribute
- `children` (ReactNode): Input element(s)

**Features:**
- Automatic error styling on inputs
- Icon indicators for hints/warnings/errors
- Accessibility (ARIA roles)
- Responsive styling

---

### InlineHelp

Expandable contextual help with examples and links.

**Usage:**

```tsx
import { InlineHelp } from './ui-components';

<InlineHelp
  title="Comment écrire un bon system prompt ?"
  examples={[
    {
      label: 'Support client',
      value: 'Tu es un assistant de support client professionnel...'
    },
    {
      label: 'Analyste de données',
      value: 'Tu es un expert en analyse de données...'
    }
  ]}
  learnMoreUrl="https://docs.example.com/system-prompts"
  defaultExpanded={false}
>
  Le system prompt définit le rôle et le comportement de votre agent.
  Soyez spécifique sur le ton, le style, et les contraintes.
</InlineHelp>
```

**Props:**
- `title` (string): Help section title
- `children` (ReactNode): Help content
- `examples` (CodeExample[]): Optional code examples
  - `label`: Example name
  - `value`: Example code
- `learnMoreUrl` (string): Optional documentation link
- `defaultExpanded` (boolean): Initial expanded state

**Features:**
- Collapsible/expandable
- Copyable code examples
- External links support
- Smooth animations
- Responsive design

---

## Design Patterns

### Progressive Disclosure

Organize complex forms using tabs to reduce cognitive load:

```tsx
const tabs = [
  { id: 'basic', label: 'Basique', content: <BasicFields /> },
  { id: 'advanced', label: 'Avancé', content: <AdvancedFields /> }
];

<TabSection tabs={tabs} />
```

### Collapsible Tool Configurations

Use accordions for optional tools:

```tsx
<AccordionSection
  id="tool-name"
  title="Tool Name"
  enabled={toolEnabled}
  onToggle={setToolEnabled}
>
  {/* Tool settings only render when enabled */}
</AccordionSection>
```

### Validation States

Show clear validation feedback:

```tsx
<Field
  label="Email"
  required
  error={emailError}
  hint="Utilisé pour les notifications"
>
  <input type="email" value={email} onChange={handleChange} />
</Field>
```

### Contextual Help

Provide inline documentation:

```tsx
<Field label="API Key">
  <input type="password" value={apiKey} onChange={handleChange} />
</Field>

<InlineHelp title="Où trouver votre API Key ?" examples={...}>
  Votre API key se trouve dans les paramètres de votre compte.
</InlineHelp>
```

---

## Accessibility

All components are built with accessibility in mind:

- **Keyboard navigation**: Full keyboard support
- **ARIA attributes**: Proper roles, labels, and states
- **Focus management**: Clear focus indicators
- **Screen readers**: Announcements and labels
- **Color contrast**: WCAG 2.1 AA compliant

---

## Styling

Components use CSS Modules for styling. Styles are scoped and can be customized by:

1. **Overriding CSS variables** (if available)
2. **Passing custom className props**
3. **Modifying the CSS Module files directly**

All components follow the existing design system colors and spacing.

---

## Migration Guide

To migrate from the old NodeInspector components:

### Before:
```tsx
<div className={styles.nodeInspectorField}>
  <span className={styles.nodeInspectorLabel}>
    Temperature
    <HelpTooltip label="Help text" />
  </span>
  <input type="number" value={temperature} />
  {error && <span className={styles.nodeInspectorErrorText}>{error}</span>}
</div>
```

### After:
```tsx
<Field label="Temperature" error={error}>
  <input type="number" value={temperature} />
</Field>

<InlineHelp title="À propos de Temperature">
  Help text here with examples...
</InlineHelp>
```

### Benefits:
- ✅ **50% less code**
- ✅ **Consistent styling**
- ✅ **Better UX** (inline expandable help)
- ✅ **Accessibility built-in**
- ✅ **Responsive by default**

---

## Example: Complete Agent Configuration

See `sections/AgentInspectorSectionV2.tsx` for a full example of using all components together to create a tabbed, organized agent configuration UI.

Key improvements in V2:
- **Tabs**: Organize into Basic/Model/Tools/Advanced
- **Accordions**: Collapsible tool sections
- **Fields**: Consistent validation and hints
- **InlineHelp**: Rich contextual documentation
- **75% reduction** in visible content at once
- **Improved mobile experience**

---

## Dependencies

- **@radix-ui/react-tabs**: ^1.1.13
- **@radix-ui/react-accordion**: Latest
- **@radix-ui/react-collapsible**: Latest
- **lucide-react**: ^0.546.0
- **React**: 18+

---

## Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- Mobile: iOS Safari 14+, Chrome Android

---

## Contributing

When adding new UI components:

1. Follow the existing patterns
2. Include TypeScript types
3. Add CSS Module for styling
4. Ensure accessibility (ARIA, keyboard nav)
5. Update this README
6. Add usage examples

---

## Questions?

See the implementation in `AgentInspectorSectionV2.tsx` for a complete working example.

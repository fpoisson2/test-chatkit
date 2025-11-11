# CSS Architecture - Modular Structure

This directory contains the modularized CSS architecture for the ChatKit frontend.

## Structure

```
styles/
├── index.css           # Main entry point, imports all modules
├── legacy.css          # Legacy styles (to be migrated in future phases)
├── tokens/             # Design tokens (CSS custom properties)
│   ├── colors.css      # Color palette and theme variables
│   ├── typography.css  # Font families and text styles
│   ├── spacing.css     # Layout dimensions and spacing
│   └── shadows.css     # Box shadows and elevation
├── base/               # Base styles and resets
│   ├── reset.css       # CSS reset and normalization
│   └── utilities.css   # Utility classes
├── components/         # Component-specific styles
│   ├── buttons.css     # Button variants and states
│   ├── forms.css       # Form inputs and validation
│   ├── cards.css       # Card layouts and containers
│   ├── layout.css      # Main layout and grid system
│   ├── sidebar.css     # Sidebar styles (placeholder)
│   └── admin.css       # Admin panel styles (placeholder)
└── themes/             # Theme variations (future)
```

## Import Order

The `index.css` file imports modules in this order:

1. **Tokens** - Design tokens and CSS variables
2. **Base** - Resets and global styles
3. **Components** - Component-specific styles
4. **Legacy** - Remaining styles to be migrated

## Migration Status

### Phase 1 ✅ (Completed)
- ✅ Created modular directory structure
- ✅ Extracted design tokens (colors, typography, spacing, shadows)
- ✅ Extracted base styles (reset, utilities)
- ✅ Extracted core components (buttons, forms, cards, layout)
- ✅ Created ResponsiveCard and ResponsiveTable components
- ✅ Installed React Hook Form + Zod for form handling

### Future Phases
- ⏳ Phase 2: Extract sidebar.css and admin.css from legacy
- ⏳ Phase 3: Migrate remaining legacy styles
- ⏳ Phase 4: Implement theme system
- ⏳ Phase 5: Add CSS-in-JS or CSS Modules for component isolation

## Usage

### Importing Styles

The main entry point is automatically imported in `main.tsx`:

```typescript
import "./styles/index.css";
```

### Using Design Tokens

All CSS custom properties are available globally:

```css
.my-component {
  color: var(--text-color);
  background: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  padding: clamp(12px, 3vw, 16px);
}
```

### Using Responsive Components

```typescript
import { ResponsiveCard, ResponsiveTable } from '../components';

// ResponsiveCard - Mobile-optimized card
<ResponsiveCard>
  <h2>Configuration</h2>
  <input type="text" placeholder="Long URL..." />
</ResponsiveCard>

// ResponsiveTable - Adaptive table layout
<ResponsiveTable
  columns={columns}
  data={data}
  keyExtractor={(item) => item.id}
  mobileCardView={true}
/>
```

## Design Tokens Reference

### Colors
- `--primary-color` - Primary brand color
- `--text-color` - Main text color
- `--text-muted` - Muted/secondary text
- `--color-surface` - Surface background
- `--color-border-subtle` - Subtle borders
- `--danger-color` - Error/danger state

### Spacing
- `--header-height` - Header height with clamp
- `--chatkit-sidebar-width` - Sidebar width (responsive)

### Shadows
- `--shadow-soft` - Soft shadow for cards
- `--shadow-card` - Card elevation shadow

## Benefits of Modular CSS

1. **Maintainability** - Easier to find and update styles
2. **Performance** - Better caching and code splitting potential
3. **Scalability** - Clear organization for growing codebase
4. **Reusability** - Shared tokens and utilities
5. **Developer Experience** - Faster navigation and clearer structure

## Contributing

When adding new styles:

1. **Determine the appropriate module** (tokens, base, or component)
2. **Add styles to the relevant file** or create a new one
3. **Import the new file** in `index.css` if needed
4. **Document any new tokens** or utilities in this README
5. **Test on mobile and desktop** to ensure responsiveness

## Notes

- `legacy.css` contains styles not yet modularized
- `sidebar.css` and `admin.css` are placeholders for future migration
- All new styles should follow the modular pattern
- Use CSS custom properties for theming and consistency

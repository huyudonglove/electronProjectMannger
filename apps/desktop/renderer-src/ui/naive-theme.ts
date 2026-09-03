import type { GlobalThemeOverrides } from 'naive-ui'

export const naiveThemeOverrides: GlobalThemeOverrides = {
  common: {
    // Naive derives translucent variants with JS color utilities, which cannot
    // resolve CSS custom properties. Keep these source colors parseable and let
    // the component-level CSS tokens continue to control the surrounding UI.
    primaryColor: '#a45f2a',
    primaryColorHover: '#d08a50',
    primaryColorPressed: '#874b23',
    primaryColorSuppl: '#a45f2a',
    borderRadius: 'var(--radius-control)',
    borderRadiusSmall: 'var(--radius-control)',
    fontSize: 'var(--font-size-md)',
    fontSizeSmall: 'var(--font-size-sm)',
    fontWeightStrong: '650',
    heightSmall: 'var(--control-height-md)',
  },
  Select: {
    peers: {
      InternalSelection: {
        border: '1px solid var(--border)',
        borderHover: '1px solid var(--border-strong)',
        color: 'var(--field-bg)',
        textColor: 'var(--text)',
        arrowColor: 'var(--muted)',
        borderFocus: '1px solid var(--primary)',
        boxShadowFocus: '0 0 0 3px var(--focus-ring)',
      },
      InternalSelectMenu: {
        color: 'var(--surface-raised)',
        optionTextColor: 'var(--text)',
        optionTextColorActive: 'var(--primary-text)',
        optionColorPending: 'var(--hover)',
        optionColorActive: 'var(--active)',
        optionCheckColor: 'var(--primary-text)',
      },
    },
  },
}

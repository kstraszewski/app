type FieldFocusColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

interface FieldFocusVariant {
  color: FieldFocusColor
  variant: ('outline' | 'subtle')[]
  class: string
}

const fieldFocusVariants: FieldFocusVariant[] = [
  { color: 'primary', variant: ['outline', 'subtle'], class: 'focus:ring-2 focus:ring-inset focus:ring-primary' },
  { color: 'secondary', variant: ['outline', 'subtle'], class: 'focus:ring-2 focus:ring-inset focus:ring-secondary' },
  { color: 'success', variant: ['outline', 'subtle'], class: 'focus:ring-2 focus:ring-inset focus:ring-success' },
  { color: 'info', variant: ['outline', 'subtle'], class: 'focus:ring-2 focus:ring-inset focus:ring-info' },
  { color: 'warning', variant: ['outline', 'subtle'], class: 'focus:ring-2 focus:ring-inset focus:ring-warning' },
  { color: 'error', variant: ['outline', 'subtle'], class: 'focus:ring-2 focus:ring-inset focus:ring-error' },
  { color: 'neutral', variant: ['outline', 'subtle'], class: 'focus:ring-2 focus:ring-inset focus:ring-inverted' },
]

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'neutral',
      secondary: 'neutral',
      neutral: 'neutral',
      success: 'green',
      info: 'neutral',
      warning: 'yellow',
      error: 'red',
    },
    button: {
      slots: {
        base: 'min-h-[var(--oe-control-height)] rounded-[var(--oe-radius-control)] px-[var(--oe-button-padding-x)] text-sm font-[var(--oe-button-font-weight)] cursor-pointer oe-pressable',
      },
      variants: {
        square: {
          true: {
            base: 'aspect-square px-0',
          },
        },
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'outline',
        size: 'md',
      },
    },
    input: {
      slots: {
        base: 'rounded-[var(--oe-radius-control)] oe-field-motion',
      },
      compoundVariants: fieldFocusVariants,
      defaultVariants: {
        color: 'neutral',
        variant: 'outline',
        size: 'xl',
      },
    },
    formField: {
      slots: {
        label: 'font-medium text-highlighted',
        description: 'text-muted',
        error: 'text-error',
      },
      defaultVariants: {
        size: 'xl',
      },
    },
    alert: {
      slots: {
        root: 'rounded-[var(--oe-radius-surface)]',
        title: 'font-medium',
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'subtle',
      },
    },
  },
})

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
            base: 'aspect-square justify-center px-0',
          },
        },
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'outline',
        size: 'md',
      },
    },
    card: {
      slots: {
        root: 'rounded-[var(--oe-radius-surface)] shadow-none',
        header: 'p-4 sm:px-5',
        body: 'p-4 sm:p-5',
        footer: 'p-4 sm:px-5',
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
    inputNumber: {
      slots: {
        base: 'rounded-[var(--oe-radius-control)] oe-field-motion',
      },
      compoundVariants: fieldFocusVariants,
      defaultVariants: {
        size: 'xl',
      },
    },
    inputMenu: {
      slots: {
        root: 'oe-field-motion',
        base: 'rounded-[var(--oe-radius-control)] oe-field-motion',
        content: 'oe-overlay-motion-fast',
        item: 'oe-state-motion',
      },
      compoundVariants: fieldFocusVariants,
      defaultVariants: {
        size: 'xl',
      },
    },
    inputTags: {
      defaultVariants: {
        size: 'xl',
      },
    },
    textarea: {
      slots: {
        base: 'rounded-[var(--oe-radius-control)] oe-field-motion',
      },
      compoundVariants: fieldFocusVariants,
      defaultVariants: {
        size: 'xl',
      },
    },
    select: {
      slots: {
        base: 'rounded-[var(--oe-radius-control)] oe-field-motion',
        content: 'oe-overlay-motion-fast',
        item: 'oe-state-motion',
      },
      defaultVariants: {
        size: 'xl',
      },
    },
    selectMenu: {
      slots: {
        base: 'rounded-[var(--oe-radius-control)] oe-field-motion',
        content: 'oe-overlay-motion-fast',
        item: 'oe-state-motion',
      },
      compoundVariants: fieldFocusVariants,
      defaultVariants: {
        size: 'xl',
      },
    },
    checkbox: {
      slots: {
        root: 'oe-state-motion',
        base: 'oe-choice-motion',
        indicator: 'oe-choice-indicator-motion',
      },
    },
    radioGroup: {
      slots: {
        item: 'oe-state-motion',
        base: 'oe-choice-motion',
        indicator: 'oe-choice-indicator-motion',
      },
    },
    switch: {
      slots: {
        base: 'oe-switch-track-motion',
        thumb: 'oe-switch-thumb-motion',
        icon: 'oe-state-motion',
      },
    },
    slider: {
      slots: {
        thumb: 'oe-slider-thumb-motion',
      },
    },
    badge: {
      slots: {
        base: 'rounded-[calc(var(--oe-radius-control)-2px)] font-medium',
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'outline',
        size: 'sm',
      },
    },
    tabs: {
      slots: {
        list: 'rounded-[var(--oe-radius-control)] ring ring-default bg-muted',
        trigger: 'rounded-[calc(var(--oe-radius-control)-4px)] oe-state-motion',
        indicator: 'rounded-[calc(var(--oe-radius-control)-4px)] oe-indicator-motion',
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'pill',
        size: 'sm',
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
    modal: {
      slots: {
        overlay: 'oe-overlay-motion-base',
        content: 'oe-overlay-motion-base',
      },
    },
    slideover: {
      slots: {
        overlay: 'oe-overlay-motion-base',
        content: 'oe-overlay-motion-base',
      },
    },
    popover: {
      slots: {
        content: 'oe-overlay-motion-fast',
      },
    },
    dropdownMenu: {
      slots: {
        content: 'oe-overlay-motion-fast',
        item: 'oe-state-motion',
      },
    },
    tooltip: {
      slots: {
        content: 'oe-overlay-motion-fast',
      },
    },
    accordion: {
      slots: {
        content: 'oe-disclosure-motion',
        trailingIcon: 'oe-indicator-motion',
      },
    },
    collapsible: {
      slots: {
        content: 'oe-disclosure-motion',
      },
    },
    toast: {
      slots: {
        root: 'oe-state-motion',
      },
    },
    toaster: {
      slots: {
        base: 'oe-overlay-motion-base',
      },
    },
  },
})

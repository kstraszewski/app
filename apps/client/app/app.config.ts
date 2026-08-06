type FieldFocusColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

interface FieldFocusVariant {
  color: FieldFocusColor
  variant: ('outline' | 'subtle')[]
  class: string
}

const fieldFocusVariants: FieldFocusVariant[] = [
  { color: 'primary', variant: ['outline', 'subtle'], class: 'focus:ring-2 focus:ring-inset focus:ring-primary' },
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
      warning: 'amber',
      error: 'red',
    },
    icons: {
      loading: 'i-lucide-loader-circle',
      close: 'i-lucide-x',
      check: 'i-lucide-check',
      chevronDown: 'i-lucide-chevron-down',
      chevronRight: 'i-lucide-chevron-right',
      arrowLeft: 'i-lucide-arrow-left',
      arrowRight: 'i-lucide-arrow-right',
    },
    button: {
      slots: {
        base: 'min-h-11 rounded-xl px-5 text-sm font-semibold cursor-pointer oe-pressable',
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'outline',
        size: 'md',
      },
    },
    card: {
      slots: {
        root: 'rounded-2xl shadow-none',
        header: 'p-5 sm:px-6',
        body: 'p-5 sm:p-6',
        footer: 'p-5 sm:px-6',
      },
    },
    input: {
      slots: { base: 'rounded-xl oe-field-motion' },
      compoundVariants: fieldFocusVariants,
      defaultVariants: { color: 'neutral', variant: 'outline', size: 'xl' },
    },
    textarea: {
      slots: { base: 'rounded-xl oe-field-motion' },
      compoundVariants: fieldFocusVariants,
      defaultVariants: { color: 'neutral', variant: 'outline', size: 'xl' },
    },
    select: {
      slots: {
        base: 'rounded-xl oe-field-motion',
        content: 'oe-overlay-motion-fast',
        item: 'oe-state-motion',
      },
      defaultVariants: { color: 'neutral', variant: 'outline', size: 'xl' },
    },
    inputMenu: {
      slots: {
        root: 'oe-field-motion',
        base: 'rounded-xl oe-field-motion',
        content: 'oe-overlay-motion-fast',
        item: 'oe-state-motion',
      },
      compoundVariants: fieldFocusVariants,
    },
    selectMenu: {
      slots: {
        base: 'rounded-xl oe-field-motion',
        content: 'oe-overlay-motion-fast',
        item: 'oe-state-motion',
      },
      compoundVariants: fieldFocusVariants,
    },
    formField: {
      slots: {
        label: 'font-medium text-highlighted',
        description: 'text-muted',
        error: 'text-error',
      },
      defaultVariants: { size: 'xl' },
    },
    alert: {
      slots: { root: 'rounded-xl', title: 'font-semibold' },
      defaultVariants: { color: 'neutral', variant: 'subtle' },
    },
    badge: {
      slots: { base: 'rounded-lg font-medium' },
      defaultVariants: { color: 'neutral', variant: 'outline', size: 'sm' },
    },
    tabs: {
      slots: {
        trigger: 'oe-state-motion',
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
      slots: { content: 'oe-overlay-motion-fast' },
    },
    dropdownMenu: {
      slots: {
        content: 'oe-overlay-motion-fast',
        item: 'oe-state-motion',
      },
    },
    tooltip: {
      slots: { content: 'oe-overlay-motion-fast' },
    },
    accordion: {
      slots: {
        content: 'oe-disclosure-motion',
      },
    },
    collapsible: {
      slots: { content: 'oe-disclosure-motion' },
    },
    toast: {
      slots: { root: 'oe-state-motion' },
    },
    toaster: {
      slots: { base: 'oe-overlay-motion-base' },
    },
  },
})

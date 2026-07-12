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
        base: 'rounded-[var(--oe-radius-control)]',
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'outline',
        size: 'sm',
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
        trigger: 'rounded-[calc(var(--oe-radius-control)-4px)]',
        indicator: 'rounded-[calc(var(--oe-radius-control)-4px)]',
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
        size: 'sm',
      },
    },
  },
})

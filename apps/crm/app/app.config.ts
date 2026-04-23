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
        base: 'rounded-sm font-medium cursor-pointer oe-pressable',
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'outline',
        size: 'sm',
      },
    },
    card: {
      slots: {
        root: 'rounded-sm shadow-none',
        header: 'p-4 sm:px-5',
        body: 'p-4 sm:p-5',
        footer: 'p-4 sm:px-5',
      },
    },
    input: {
      slots: {
        base: 'rounded-sm',
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'outline',
        size: 'sm',
      },
    },
    badge: {
      slots: {
        base: 'rounded-xs font-medium',
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'outline',
        size: 'sm',
      },
    },
    tabs: {
      slots: {
        list: 'rounded-sm ring ring-default bg-muted',
        trigger: 'rounded-xs',
        indicator: 'rounded-xs',
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'pill',
        size: 'sm',
      },
    },
    alert: {
      slots: {
        root: 'rounded-sm',
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

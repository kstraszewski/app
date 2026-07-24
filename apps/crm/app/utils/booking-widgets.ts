import type { BookingWidget } from '~/types/scheduling'
import type { BookingWidgetType } from '#shared/types/booking-calculators'

export interface BookingWidgetTypeOption {
  value: BookingWidgetType
  label: string
  description: string
  icon: string
  defaultName: string
  defaultTitle: string
}

export const BOOKING_WIDGET_TYPES: BookingWidgetTypeOption[] = [
  {
    value: 'mortgage_capacity',
    label: 'Kalkulator zdolności',
    description: 'Klient oblicza orientacyjną zdolność, a następnie wybiera termin spotkania.',
    icon: 'i-lucide-chart-no-axes-combined',
    defaultName: 'Mój kalkulator zdolności',
    defaultTitle: 'Sprawdź swoją zdolność kredytową',
  },
  {
    value: 'mortgage_payment',
    label: 'Kalkulator raty',
    description: 'Klient szacuje ratę kredytu i przechodzi bezpośrednio do rezerwacji.',
    icon: 'i-lucide-calculator',
    defaultName: 'Mój kalkulator raty',
    defaultTitle: 'Oblicz ratę kredytu',
  },
  {
    value: 'calendar',
    label: 'Kalendarz',
    description: 'Najkrótsza ścieżka: wybór terminu i rejestracja klienta.',
    icon: 'i-lucide-calendar-days',
    defaultName: 'Mój kalendarz spotkań',
    defaultTitle: 'Umów spotkanie',
  },
]

export function bookingWidgetTypeMeta(type: BookingWidgetType): BookingWidgetTypeOption {
  return BOOKING_WIDGET_TYPES.find(item => item.value === type)
    ?? BOOKING_WIDGET_TYPES[2]!
}

export function bookingWidgetScriptSnippet(widget: BookingWidget): string {
  let origin = ''
  try {
    origin = new URL(widget.publicUrl).origin
  } catch {
    if (import.meta.client) origin = window.location.origin
  }
  return `<script src="${origin}/booking-widget.js" data-openexpert-widget="${widget.widgetKey}" async></script>`
}

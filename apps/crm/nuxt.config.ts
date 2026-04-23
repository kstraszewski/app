// https://nuxt.com/docs/api/configuration/nuxt-config
const hasSupabaseConfig = Boolean(
  process.env.NUXT_PUBLIC_SUPABASE_URL && process.env.NUXT_PUBLIC_SUPABASE_KEY,
)

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  vite: {
    server: {
      hmr: false,
    },
  },
  hooks: {
    'vite:extendConfig'(config) {
      config.server ||= {}
      config.server.hmr = false
    },
  },
  modules: ['@nuxt/ui', '@nuxtjs/supabase'],
  css: ['~/assets/css/main.css'],
  ui: {
    fonts: false,
    theme: {
      colors: ['primary', 'secondary', 'success', 'info', 'warning', 'error'],
      transitions: true,
      defaultVariants: {
        color: 'neutral',
        size: 'sm',
      },
    },
  },
  runtimeConfig: {
    public: {
      openexpert: {
        hasSupabaseConfig,
      },
      supabase: {
        url: process.env.NUXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
        key: process.env.NUXT_PUBLIC_SUPABASE_KEY || 'local-development-placeholder',
      },
    },
  },
  supabase: {
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/login', '/confirm', '/design'],
    },
  },
  app: {
    pageTransition: { name: 'oe-page', mode: 'out-in' },
    head: {
      htmlAttrs: { lang: 'pl' },
      title: 'OpenExpert CRM',
      meta: [
        { name: 'description', content: 'CRM dla platformy OpenExpert.' },
      ],
    },
  },
})

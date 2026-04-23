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
  modules: ['@nuxtjs/supabase'],
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
      exclude: ['/', '/waitlist', '/api/mcp'],
    },
  },
  css: ['~/assets/css/design.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'pl' },
      title: 'OpenExpert — Modułowa platforma dla ekspertów',
      meta: [
        { name: 'description', content: 'Modułowa platforma open source dla ekspertów. Dobieraj moduły, łącz je dowolnie i buduj własne. Obsługuje człowieka i agenta AI — przez UI, REST API i protokół MCP.' },
        { name: 'apple-mobile-web-app-title', content: 'OpenExpert' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon-96x96.png', sizes: '96x96' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'shortcut icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
    },
  },
})

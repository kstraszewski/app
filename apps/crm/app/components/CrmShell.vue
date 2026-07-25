<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  title: string
  eyebrow?: string
  description?: string
  backTo?: string
  backLabel?: string
  tabs?: Array<{
    label: string
    to: RouteLocationRaw
    icon?: string
    count?: number
    exact?: boolean
    active?: boolean
  }>
}>()

const hasSupabaseConfig = useHasSupabaseConfig()
</script>

<template>
  <div class="crm-page">
    <CrmPageHeader
      :title="props.title"
      :eyebrow="props.eyebrow"
      :description="props.description"
      :back-to="props.backTo"
      :back-label="props.backLabel"
      :tabs="props.tabs"
    >
      <template v-if="$slots.meta" #meta>
        <slot name="meta" />
      </template>
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </CrmPageHeader>

    <UAlert
      v-if="!hasSupabaseConfig"
      class="crm-alert"
      color="warning"
      variant="subtle"
      icon="i-lucide-alert-triangle"
      title="Brakuje konfiguracji Supabase"
      description="Uzupełnij .env, żeby API CRM mogło czytać i zapisywać dane."
    />

    <slot />
  </div>
</template>

<style scoped>
.crm-page {
  min-width: 0;
}

.crm-alert {
  margin-bottom: 24px;
}
</style>

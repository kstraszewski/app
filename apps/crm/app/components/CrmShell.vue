<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  title: string
  workspace?: boolean
  eyebrow?: string
  description?: string
  backTo?: string
  backLabel?: string
  avatarSrc?: string
  avatarAlt?: string
  avatarText?: string
  tabs?: Array<{
    label: string
    to: RouteLocationRaw
    icon?: string
    count?: number
    exact?: boolean
    active?: boolean
  }>
}>()

const hasAuthConfig = useHasAuthConfig()
</script>

<template>
  <div
    class="crm-page"
    :class="{
      'crm-page--workspace': props.workspace,
      'crm-content-mode--workspace': props.workspace,
    }"
  >
    <CrmPageHeader
      :title="props.title"
      :compact="props.workspace"
      :eyebrow="props.eyebrow"
      :description="props.description"
      :back-to="props.backTo"
      :back-label="props.backLabel"
      :avatar-src="props.avatarSrc"
      :avatar-alt="props.avatarAlt"
      :avatar-text="props.avatarText"
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
      v-if="!hasAuthConfig"
      class="crm-alert"
      color="warning"
      variant="subtle"
      icon="i-lucide-alert-triangle"
      title="Brakuje konfiguracji platformy"
      description="Uzupełnij .env, żeby API CRM mogło czytać i zapisywać dane."
    />

    <slot />
  </div>
</template>

<style scoped>
.crm-page {
  min-width: 0;
}

.crm-page--workspace {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  flex-direction: column;
}

.crm-alert {
  flex: 0 0 auto;
  margin-bottom: 24px;
}
</style>

<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  title: string
  workspace?: boolean
  compact?: boolean
  fullBleed?: boolean
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
    compact?: boolean
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
      'crm-page--compact-header': props.compact && !props.workspace,
      'crm-page--full-bleed': props.fullBleed,
      'crm-content-mode--full-bleed': props.fullBleed,
    }"
  >
    <CrmPageHeader
      :title="props.title"
      :compact="props.workspace || props.compact"
      :eyebrow="props.eyebrow"
      :description="props.description"
      :back-to="props.backTo"
      :back-label="props.backLabel"
      :avatar-src="props.avatarSrc"
      :avatar-alt="props.avatarAlt"
      :avatar-text="props.avatarText"
      :tabs="props.tabs"
    >
      <template v-if="$slots['title-trailing']" #title-trailing>
        <slot name="title-trailing" />
      </template>
      <template v-if="$slots.meta" #meta>
        <slot name="meta" />
      </template>
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </CrmPageHeader>

    <div class="crm-page__content">
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
  </div>
</template>

<style scoped>
.crm-page {
  min-width: 0;
}

.crm-page__content {
  min-width: 0;
  view-transition-name: crm-page-content;
}

.crm-page--workspace {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  flex-direction: column;
}

.crm-page--workspace .crm-page__content {
  display: flex;
  min-height: 0;
  overflow: hidden;
  flex: 1 1 0;
  flex-direction: column;
}

.crm-page--compact-header :deep(.crm-page-header--compact) {
  margin-bottom: 16px;
  padding: 0 0 12px;
  background: transparent;
}

.crm-page--full-bleed {
  min-height: 100dvh;
  background: var(--ui-bg);
}

.crm-page--full-bleed.crm-page--compact-header :deep(.crm-page-header--compact) {
  margin-bottom: 0;
  padding: 16px 24px;
  background: var(--ui-bg);
}

@media (max-width: 900px) {
  .crm-page--full-bleed {
    min-height: calc(100dvh - 76px);
  }

  .crm-page--full-bleed.crm-page--compact-header :deep(.crm-page-header--compact) {
    padding-inline: 16px;
  }
}

.crm-alert {
  flex: 0 0 auto;
  margin-bottom: 24px;
}
</style>

<script setup lang="ts">
withDefaults(defineProps<{
  compact?: boolean
}>(), {
  compact: false,
})
</script>

<template>
  <span class="brand-lockup" aria-label="OpenExpert">
    <img src="/assets/logo-mark.svg" alt="" width="27" height="27">
    <span v-if="!compact">OpenExpert</span>
  </span>
</template>

<style scoped>
.brand-lockup {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: #0a0a0a;
  font-size: 23px;
  font-weight: 650;
  letter-spacing: -0.035em;
  line-height: 1;
  white-space: nowrap;
}

.brand-lockup img {
  display: block;
  width: 27px;
  height: 27px;
}

@media (max-width: 540px) {
  .brand-lockup {
    gap: 9px;
    font-size: 19px;
  }

  .brand-lockup img {
    width: 24px;
    height: 24px;
  }
}
</style>

<script setup lang="ts">
definePageMeta({ middleware: 'preview-only' })

await navigateTo('/preview', { replace: true })
</script>

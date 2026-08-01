<script setup lang="ts">
definePageMeta({ middleware: 'client-auth' })

await navigateTo('/', { replace: true })
</script>

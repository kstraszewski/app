<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })
const { orgPath } = useOrganizationContext()
await navigateTo(orgPath('/dashboard'), { replace: true })
</script>

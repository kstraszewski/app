<script setup lang="ts">
const user = useSupabaseUser()
const { resolvePostAuthPath } = useAuthFlow()

await navigateTo(user.value ? await resolvePostAuthPath() : '/login')
</script>

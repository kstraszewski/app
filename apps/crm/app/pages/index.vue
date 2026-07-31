<script setup lang="ts">
const user = useAuthUser()
const { resolvePostAuthPath } = useAuthFlow()

await navigateTo(user.value ? await resolvePostAuthPath() : '/login')
</script>

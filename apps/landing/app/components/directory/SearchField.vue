<script setup lang="ts">
const query = defineModel<string>({ default: '' })

defineProps<{
  id: string
  label: string
  placeholder: string
  resultText: string
}>()
</script>

<template>
  <div class="directory-search">
    <label :for="id">{{ label }}</label>
    <div class="directory-search__control">
      <input
        :id="id"
        v-model="query"
        type="search"
        autocomplete="off"
        :placeholder="placeholder"
        :aria-describedby="`${id}-results`"
      >
      <button v-if="query" type="button" @click="query = ''">
        Wyczyść
      </button>
    </div>
    <p :id="`${id}-results`" aria-live="polite">{{ resultText }}</p>
  </div>
</template>

<style scoped>
.directory-search {
  display: grid;
  gap: 9px;
}

.directory-search label {
  color: #333;
  font-size: 13px;
  font-weight: 600;
}

.directory-search__control {
  display: flex;
  min-height: 54px;
  align-items: center;
  border: 1px solid #bcbcb7;
  border-radius: 5px;
  background: #fff;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.directory-search__control:focus-within {
  border-color: #111;
  box-shadow: 0 0 0 1px #111;
}

.directory-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  padding: 14px 17px;
  background: transparent;
  color: #111;
  font: inherit;
  font-size: 15px;
}

.directory-search input::placeholder {
  color: #666;
}

.directory-search input::-webkit-search-cancel-button {
  appearance: none;
}

.directory-search button {
  min-height: 38px;
  margin-right: 7px;
  border: 0;
  border-radius: 3px;
  padding: 7px 10px;
  background: #efefec;
  color: #444;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}

.directory-search button:hover {
  background: #dfdfdb;
  color: #111;
}

.directory-search p {
  min-height: 20px;
  color: #6b6b67;
  font-size: 12px;
}

.directory-search :is(input, button):focus-visible {
  outline: 2px solid #111;
  outline-offset: 2px;
}

@media (max-width: 520px) {
  .directory-search__control {
    min-height: 50px;
  }

  .directory-search input {
    padding: 12px 14px;
  }
}
</style>

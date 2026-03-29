<!-- Using a single line to avoid extraneous spaces exposed by white-space:pre -->
<template>
  <span v-if="span">{{ parts[0] }}<slot />{{ parts[1] }}</span
  ><template v-else>{{ parts[0] }}<slot />{{ parts[1] }}</template>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { i18n } from "@/common";

const SEP = "\x02";
const props = defineProps<{
  i18nKey: string;
  span?: boolean;
}>();
const parts = computed(() => i18n(props.i18nKey, [SEP]).split(SEP));
</script>

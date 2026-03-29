<template>
  <svg class="icon"><use :xlink:href="`#${name}`" /></svg>
</template>

<script lang="ts">
import "virtual:svg-icons-register";
</script>

<script setup lang="ts">
defineProps<{
  name: string;
}>();
</script>

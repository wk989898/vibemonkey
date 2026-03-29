<template>
  <component :is="tag" :class="{ feature: featured }" @click="onClick">
    <slot></slot>
  </component>
</template>

<script lang="ts">
import { computed, defineComponent } from "vue";
import options from "@/common/options";
import { objectGet } from "@/common/object";
import { store } from "../utils";

type FeatureFlags = {
  version?: string;
  data: Record<string, number>;
};

const FEATURES_KEY = "features";
store.features = options.get(FEATURES_KEY) as FeatureFlags | undefined;
options.hook((data) => {
  const features = data[FEATURES_KEY] as FeatureFlags | undefined;
  if (features) {
    store.features = features;
  }
});
options.ready.then(() => reset("sync"));

function reset(version: string) {
  if (objectGet(store, "features.version") !== version) {
    options.set(FEATURES_KEY, {
      version,
      data: {},
    });
  }
}

export default defineComponent({
  props: {
    name: {
      type: String,
      required: true,
    },
    tag: {
      type: String,
      default: "span",
    },
  },
  setup(props) {
    const featured = computed(() => {
      const features = store.features as FeatureFlags | undefined;
      return !!features && !objectGet(store, ["features", "data", props.name]);
    });
    const onClick = () => {
      const features = store.features as FeatureFlags | undefined;
      if (features && objectGet(features, "version")) {
        features.data[props.name] = 1;
        options.set(FEATURES_KEY, features);
      }
    };
    return {
      featured,
      onClick,
    };
  },
});
</script>

<style>
.feature {
  .feature-text {
    position: relative;
    &::after {
      content: "";
      display: block;
      position: absolute;
      width: 6px;
      height: 6px;
      top: -0.1rem;
      left: 100%;
      border-radius: 50%;
      margin-left: 0.1rem;
      background: red;
    }
  }
}
</style>

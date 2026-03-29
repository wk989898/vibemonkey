/// <reference types="vite/client" />

declare const hasOwnProperty: (obj: object, key: PropertyKey) => boolean;

declare const process: {
  env: Record<string, string | undefined>;
};

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<Record<string, never>, Record<string, never>, any>;
  export default component;
}

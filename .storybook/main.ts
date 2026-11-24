import type { StorybookConfig } from "@storybook/html-vite";
import { tspci } from "./vite-plugin-tspci.ts";

// The stories next to the source (src/*.stories.ts), built the way tspci builds the PCI (vite-plugin-tspci.ts).
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.ts"],
  addons: ["@storybook/addon-vitest"],
  framework: "@storybook/html-vite",
  viteFinal: async (config) => {
    config.plugins = [...(config.plugins ?? []), tspci()];
    return config;
  },
};

export default config;

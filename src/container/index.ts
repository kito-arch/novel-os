import { createContainer, createModule } from "@evyweb/ioctopus";
import type { AppConfig } from "@/config";
import { loadConfig } from "@/config";
import type { AppRegistry } from "./registry";

export * from "./registry";

export function createAppModule(config: AppConfig = loadConfig()) {
  const appModule = createModule<AppRegistry>();
  appModule.bind("CONFIG").toValue(config);
  return appModule;
}

export function buildContainer(config: AppConfig = loadConfig()) {
  const container = createContainer<AppRegistry>();
  container.load("app", createAppModule(config));
  return container;
}
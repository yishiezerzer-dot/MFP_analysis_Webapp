import type { HelpModule } from "./types";
import { aiHelpModule } from "./content/ai";
import { dataStudioHelpModule } from "./content/dataStudio";
import { ftirHelpModule } from "./content/ftir";
import { lcmsHelpModule } from "./content/lcms";
import { plateReaderHelpModule } from "./content/plateReader";

const HELP_MODULES: Record<string, HelpModule> = {
  "/lcms": lcmsHelpModule,
  "/ftir": ftirHelpModule,
  "/plate-reader": plateReaderHelpModule,
  "/data-studio": dataStudioHelpModule,
  "/ai": aiHelpModule,
};

export function getHelpModule(pathname: string): HelpModule | null {
  const base = pathname.replace(/\/$/, "") || "/";
  return HELP_MODULES[base] ?? null;
}

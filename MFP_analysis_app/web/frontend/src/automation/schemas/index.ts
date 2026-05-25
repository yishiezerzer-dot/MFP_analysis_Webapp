import { z } from "zod";
import { lcmsActionSchemas } from "./lcms";

export const automationActionSchemas = {
  ...lcmsActionSchemas,
} satisfies Record<string, z.ZodTypeAny>;

export type AutomationActionId = keyof typeof automationActionSchemas;

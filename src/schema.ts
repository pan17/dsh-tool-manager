import { normalizeSettings } from "./policy.js";

/**
 * Minimal schemastery-compatible schema: callable resolver plus toJSON.
 * DSH settings only needs `schema(value)` and `schema.toJSON()`.
 */
export function toolManagerSettingsSchema(): ((value: unknown) => unknown) & { toJSON(): unknown } {
  const schema = ((value: unknown) => normalizeSettings(value)) as ((value: unknown) => unknown) & {
    toJSON(): unknown;
  };
  schema.toJSON = () => ({
    type: "object",
    properties: {
      presets: { type: "object", additionalProperties: true },
    },
  });
  return schema;
}

import type { z } from "zod";
import type { PropResolutionContext } from "./props";

/**
 * Definition for a custom directive — a user-defined `$`-prefixed dynamic
 * value that extends the spec language.
 *
 * @example
 * ```ts
 * const formatDirective = defineDirective({
 *   name: '$format',
 *   description: 'Locale-aware value formatting (date, currency, number, percent).',
 *   schema: z.object({
 *     $format: z.enum(['date', 'currency', 'number']),
 *     value: z.unknown(),
 *   }),
 *   resolve(value, ctx) {
 *     const resolved = resolvePropValue(value.value, ctx);
 *     return new Intl.NumberFormat().format(resolved);
 *   },
 * });
 * ```
 */
export interface DirectiveDefinition<TSchema extends z.ZodType = z.ZodType> {
  /** The `$`-prefixed key that triggers this directive (e.g. `"$format"`). */
  name: string;
  /**
   * Short description of the directive for the AI system prompt.
   * The schema fields are auto-generated; this adds behavioral context.
   */
  description?: string;
  /** Zod schema for validating the directive object. */
  schema: TSchema;
  /**
   * Resolver function. Receives the raw directive value and the current
   * {@link PropResolutionContext}. May call `resolvePropValue` on sub-values
   * to support composition with other dynamic expressions.
   */
  resolve: (value: z.infer<TSchema>, ctx: PropResolutionContext) => unknown;
}

/**
 * A Map from directive name (e.g. `"$format"`) to its definition.
 * Passed through {@link PropResolutionContext} for runtime resolution.
 */
export type DirectiveRegistry = Map<string, DirectiveDefinition>;

/** Keys handled by built-in prop resolution — directives must not shadow these. */
const BUILT_IN_KEYS = new Set([
  "$state",
  "$item",
  "$index",
  "$bindState",
  "$bindItem",
  "$cond",
  "$computed",
  "$template",
]);

/**
 * Define a custom directive.
 *
 * This is an identity function that provides type checking and serves as
 * a documentation convention. Throws if the name collides with a built-in
 * prop expression key.
 */
export function defineDirective<TSchema extends z.ZodType>(
  definition: DirectiveDefinition<TSchema>,
): DirectiveDefinition<TSchema> {
  if (!definition.name.startsWith("$")) {
    throw new Error(
      `Directive name must start with "$": got "${definition.name}"`,
    );
  }
  if (BUILT_IN_KEYS.has(definition.name)) {
    throw new Error(
      `Directive name "${definition.name}" conflicts with a built-in prop expression key`,
    );
  }
  return definition;
}

/**
 * Convert an array of directive definitions into a {@link DirectiveRegistry}.
 */
export function createDirectiveRegistry(
  directives: DirectiveDefinition[],
): DirectiveRegistry {
  const registry: DirectiveRegistry = new Map();
  for (const d of directives) {
    registry.set(d.name, d);
  }
  return registry;
}

/**
 * Look up a custom directive for a plain-object value.
 *
 * Iterates the registry and checks whether the object contains a matching key.
 * Returns `undefined` when no match is found or when no registry is provided.
 *
 * This is only called **after** all built-in expressions (`$state`, `$cond`,
 * etc.) have been checked in `resolvePropValue`, so built-ins always take
 * precedence. {@link defineDirective} enforces this at registration time by
 * rejecting names that collide with built-in keys.
 */
export function findDirective(
  value: Record<string, unknown>,
  directives?: DirectiveRegistry,
): DirectiveDefinition | undefined {
  if (!directives || directives.size === 0) return undefined;
  let match: DirectiveDefinition | undefined;
  for (const [key, def] of directives) {
    if (key in value) {
      if (match) {
        throw new Error(
          `Ambiguous directive: object has multiple directive keys ("${match.name}" and "${key}")`,
        );
      }
      match = def;
    }
  }
  return match;
}

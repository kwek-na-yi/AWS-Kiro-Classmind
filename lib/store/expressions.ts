import type { Condition, UpdateSpec } from "@/lib/store/types";

/**
 * Translation of the declarative update and condition shapes into DynamoDB
 * expressions.
 *
 * Pure and SDK-free so it can be tested without the AWS SDK or a table. Every
 * attribute name is aliased (`#n0`, `#n1`, …) — `status` and other attribute
 * names here are DynamoDB reserved words, and one rule beats a list of
 * exceptions — and every value is a placeholder (`:v0`, `:v1`, …).
 */

export interface Expressions {
  UpdateExpression?: string;
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
}

class Aliases {
  readonly names: Record<string, string> = {};
  readonly values: Record<string, unknown> = {};
  private nameIndex = new Map<string, string>();
  private valueCount = 0;

  name(attribute: string): string {
    let alias = this.nameIndex.get(attribute);
    if (!alias) {
      alias = `#n${this.nameIndex.size}`;
      this.nameIndex.set(attribute, alias);
      this.names[alias] = attribute;
    }
    return alias;
  }

  value(value: unknown): string {
    const alias = `:v${this.valueCount}`;
    this.valueCount += 1;
    this.values[alias] = value;
    return alias;
  }
}

function conditionClauses(condition: Condition, aliases: Aliases): string[] {
  const clauses: string[] = [];

  if (condition.exists === true) clauses.push("attribute_exists(SK)");
  if (condition.exists === false) clauses.push("attribute_not_exists(SK)");

  for (const [name, value] of Object.entries(condition.equals ?? {})) {
    clauses.push(`${aliases.name(name)} = ${aliases.value(value)}`);
  }

  for (const [name, member] of Object.entries(condition.notContains ?? {})) {
    // `contains` over an absent attribute is false, so NOT holds — the same
    // reading the local store applies.
    clauses.push(`NOT contains(${aliases.name(name)}, ${aliases.value(member)})`);
  }

  return clauses;
}

function finish<T extends Expressions>(aliases: Aliases, out: T): T {
  if (Object.keys(aliases.names).length > 0) out.ExpressionAttributeNames = aliases.names;
  if (Object.keys(aliases.values).length > 0) out.ExpressionAttributeValues = aliases.values;
  return out;
}

/** The expressions for a conditional put, or an empty object when unconditional. */
export function buildCondition(condition?: Condition): Expressions {
  const aliases = new Aliases();
  const clauses = condition ? conditionClauses(condition, aliases) : [];
  return finish(aliases, clauses.length > 0 ? { ConditionExpression: clauses.join(" AND ") } : {});
}

/** The expressions for an `UpdateItem`. */
export function buildUpdate(
  update: UpdateSpec,
  condition?: Condition,
): Expressions & { UpdateExpression: string } {
  const aliases = new Aliases();
  const sets: string[] = [];
  const adds: string[] = [];

  for (const [name, value] of Object.entries(update.set ?? {})) {
    sets.push(`${aliases.name(name)} = ${aliases.value(value)}`);
  }

  for (const [name, by] of Object.entries(update.increment ?? {})) {
    const alias = aliases.name(name);
    sets.push(`${alias} = if_not_exists(${alias}, ${aliases.value(0)}) + ${aliases.value(by)}`);
  }

  for (const [name, values] of Object.entries(update.appendToList ?? {})) {
    const alias = aliases.name(name);
    sets.push(
      `${alias} = list_append(if_not_exists(${alias}, ${aliases.value([])}), ${aliases.value(values)})`,
    );
  }

  for (const [name, members] of Object.entries(update.addToSet ?? {})) {
    // A DynamoDB string set: `ADD` creates the attribute on first use.
    adds.push(`${aliases.name(name)} ${aliases.value(new Set(members))}`);
  }

  const parts: string[] = [];
  if (sets.length > 0) parts.push(`SET ${sets.join(", ")}`);
  if (adds.length > 0) parts.push(`ADD ${adds.join(", ")}`);
  if (parts.length === 0) throw new Error("An update must change at least one attribute");

  const clauses = condition ? conditionClauses(condition, aliases) : [];

  return finish(aliases, {
    UpdateExpression: parts.join(" "),
    ...(clauses.length > 0 ? { ConditionExpression: clauses.join(" AND ") } : {}),
  });
}

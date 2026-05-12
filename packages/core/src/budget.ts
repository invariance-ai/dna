/**
 * Token-budget packer for prepareEdit's markdown output.
 *
 * Sections are passed in priority order. We estimate tokens at 4 chars each,
 * keep sections whole when they fit, and trim list-bodied sections by item
 * when partial inclusion is possible. A section with no items is skipped.
 */

export interface PackSection {
  /** Section heading (e.g. "## Invariants that apply"). Rendered as-is. */
  heading: string;
  /** Preamble before items; empty string when none. */
  preamble?: string;
  /** Item lines (already markdown-formatted). */
  items: string[];
  /** Trailing fixed content (e.g. "_no tests found_"). Only kept whole. */
  trailing?: string;
}

export interface PackResult {
  text: string;
  kept: Array<{ section: string; items: number }>;
  dropped: Array<{ section: string; items: number; reason: "budget" | "empty" }>;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Pack sections into a single markdown string under budgetTokens. Sections
 * earlier in the array are prioritized; later ones get dropped first.
 * budgetTokens <= 0 means "unlimited" — caller controls whether to pass one.
 */
export function packByBudget(sections: PackSection[], budgetTokens: number): PackResult {
  const out: string[] = [];
  const kept: Array<{ section: string; items: number }> = [];
  const dropped: Array<{ section: string; items: number; reason: "budget" | "empty" }> = [];
  const unlimited = !budgetTokens || budgetTokens <= 0;

  let used = 0;
  for (const s of sections) {
    const hasContent = (s.items.length > 0) || !!s.trailing;
    if (!hasContent) {
      dropped.push({ section: s.heading, items: 0, reason: "empty" });
      continue;
    }
    const headerBlock = [s.heading, s.preamble ?? ""].filter(Boolean).join("\n");
    const headerCost = estimateTokens(headerBlock) + 1;

    if (unlimited) {
      out.push(headerBlock);
      for (const item of s.items) out.push(item);
      if (s.trailing) out.push(s.trailing);
      out.push("");
      kept.push({ section: s.heading, items: s.items.length });
      continue;
    }

    if (used + headerCost > budgetTokens) {
      dropped.push({ section: s.heading, items: s.items.length, reason: "budget" });
      continue;
    }

    const buffer: string[] = [headerBlock];
    let sectionUsed = headerCost;
    let keptItems = 0;
    for (const item of s.items) {
      const cost = estimateTokens(item) + 1;
      if (used + sectionUsed + cost > budgetTokens) break;
      buffer.push(item);
      sectionUsed += cost;
      keptItems += 1;
    }
    if (s.trailing && keptItems === s.items.length) {
      const cost = estimateTokens(s.trailing) + 1;
      if (used + sectionUsed + cost <= budgetTokens) {
        buffer.push(s.trailing);
        sectionUsed += cost;
      }
    }
    if (keptItems === 0 && !s.trailing) {
      dropped.push({ section: s.heading, items: s.items.length, reason: "budget" });
      continue;
    }
    buffer.push("");
    out.push(...buffer);
    used += sectionUsed;
    kept.push({ section: s.heading, items: keptItems });
    if (keptItems < s.items.length) {
      dropped.push({
        section: s.heading,
        items: s.items.length - keptItems,
        reason: "budget",
      });
    }
  }

  return { text: out.join("\n"), kept, dropped };
}

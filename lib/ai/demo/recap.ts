import {
  citedUnits,
  inReadingOrder,
  scoreSentences,
  type IndexedCorpus,
  type ScoredSentence,
  type TopicView,
} from "@/lib/ai/demo/corpus";
import {
  asSentence,
  normalise,
  shapeOf,
  truncateWords,
  wordCount,
} from "@/lib/ai/demo/text";
import type {
  ArtefactOutput,
  LearnerProfileInput,
  RecapOutput,
  RecapSectionOutput,
} from "@/lib/ai/provider";
import type { ExplanationStyle, UnderstandingLevel } from "@/lib/types";

/**
 * Deterministic Recap construction.
 *
 * Every sentence in a Recap is a sentence from the lecture material. The
 * provider selects, orders and frames source sentences; it never writes a claim
 * of its own. Framing text — a section's lead-in label, a "Worked example"
 * marker, a table header — describes *where the reader is*, and never asserts
 * anything about the subject, so nothing unsupported can enter a Recap.
 */

/** Sentences selected per section, by style. */
const SENTENCE_BUDGET: Record<ExplanationStyle, number> = {
  Concise: 4,
  Detailed: 6,
  Examples: 4,
  Step_By_Step: 5,
  Visual_Structured: 4,
};

/** Hard word ceilings the style post-checks assert. */
const CONCISE_WORDS = 80;
const DETAILED_WORDS = 250;

const MIN_TAKEAWAYS = 3;
const MAX_TAKEAWAYS = 7;

/**
 * The lead-in for a section.
 *
 * A label, not a claim: it tells the Learner what kind of reading follows, which
 * is what makes the three Understanding_Levels visibly different without the
 * provider ever stating something the source does not.
 */
function leadIn(topicName: string, level: UnderstandingLevel): string {
  switch (level) {
    case "No_Understanding":
      return `${topicName} — in plain terms, from the lecture material:`;
    case "Basic_Understanding":
      return `How the parts of ${topicName} fit together, from the lecture material:`;
    case "Strong_Understanding":
      return `Conditions and qualifications stated for ${topicName}:`;
  }
}

function proseOf(sentences: readonly ScoredSentence[], limit: number): string {
  return truncateWords(
    sentences.map((sentence) => asSentence(sentence.text)).join(" "),
    limit,
  );
}

/** A markdown table of the Topic's terms against what the source says about them. */
function buildTable(topic: TopicView, sentences: readonly ScoredSentence[]): string {
  const rows: string[] = ["| Term | What the lecture material says |", "| --- | --- |"];

  const used = new Set<string>();

  for (const term of topic.terms) {
    const match = sentences.find(
      (sentence) =>
        !used.has(sentence.text) &&
        new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
          sentence.text,
        ),
    );

    if (!match) continue;

    used.add(match.text);
    rows.push(`| ${term} | ${truncateWords(match.text, 24).replace(/\|/g, "/")} |`);

    if (rows.length >= 6) break;
  }

  // A table needs at least one row of content to be worth rendering.
  if (rows.length === 2 && sentences.length > 0) {
    rows.push(`| ${topic.name} | ${truncateWords(sentences[0].text, 24)} |`);
  }

  return rows.join("\n");
}

/** An ordered pipeline of named stages, drawn from the source's own sequence. */
function buildPipeline(sentences: readonly ScoredSentence[]): string {
  return sentences
    .slice(0, 5)
    .map((sentence, index) => `${index + 1}. ${truncateWords(sentence.text, 18)}`)
    .join("\n→ ");
}

/**
 * Chooses the artefact form.
 *
 * A pipeline when the source describes an ordered process, a table otherwise.
 * Mermaid is part of the contract but the demo provider does not emit it: a
 * diagram asserts relationships between concepts, and inferring those from text
 * is exactly the judgement a deterministic extractor cannot make honestly.
 */
function buildArtefact(
  topic: TopicView,
  sentences: readonly ScoredSentence[],
): ArtefactOutput {
  if (sentences.length === 0) return { kind: "none", content: "" };

  const sequential = sentences.filter(
    (sentence) => shapeOf(sentence.text).sequential,
  ).length;

  if (sequential >= 2) {
    return { kind: "pipeline", content: buildPipeline(sentences) };
  }

  return { kind: "table", content: buildTable(topic, sentences) };
}

interface ComposedSection {
  body: string;
  proseBody: string;
  artefact: ArtefactOutput;
  styleWarning?: string;
}

function compose(
  topic: TopicView,
  sentences: readonly ScoredSentence[],
  profile: LearnerProfileInput,
): ComposedSection {
  const label = leadIn(topic.name, profile.understandingLevel);
  const prose = proseOf(sentences, DETAILED_WORDS);

  switch (profile.explanationStyle) {
    case "Concise": {
      const bullets: string[] = [];
      let words = wordCount(label);

      for (const sentence of sentences) {
        const bullet = `- ${truncateWords(sentence.text, 20)}`;
        if (words + wordCount(bullet) > CONCISE_WORDS) break;
        bullets.push(bullet);
        words += wordCount(bullet);
      }

      if (bullets.length === 0 && sentences.length > 0) {
        bullets.push(`- ${truncateWords(sentences[0].text, 20)}`);
      }

      return {
        body: [label, ...bullets].join("\n"),
        proseBody: prose,
        artefact: { kind: "none", content: "" },
      };
    }

    case "Detailed": {
      return {
        body: `${label}\n${truncateWords(prose, DETAILED_WORDS - wordCount(label))}`,
        proseBody: prose,
        artefact: { kind: "none", content: "" },
      };
    }

    case "Examples": {
      // Prefer a sentence the source itself frames as an illustration; failing
      // that, the most specific one available. Either way it is quoted, not
      // invented — the marker is the provider's only contribution.
      const example =
        sentences.find((sentence) => shapeOf(sentence.text).exemplifying) ??
        sentences.find((sentence) => /\d/.test(sentence.text)) ??
        sentences[0];

      const rest = sentences.filter((sentence) => sentence !== example);

      return {
        body: [
          label,
          proseOf(rest.length > 0 ? rest : sentences, DETAILED_WORDS),
          example ? `Worked example, from the lecture material: ${asSentence(example.text)}` : "",
        ]
          .filter((part) => part.length > 0)
          .join("\n"),
        proseBody: prose,
        artefact: { kind: "none", content: "" },
      };
    }

    case "Step_By_Step": {
      const steps = sentences.map(
        (sentence, index) => `${index + 1}. ${asSentence(sentence.text)}`,
      );

      // The style requires an ordered sequence; a single-sentence Topic cannot
      // supply one, so the second step points at the source rather than
      // inventing content to fill it.
      if (steps.length === 1) {
        steps.push("2. Re-read the cited source unit for the full wording.");
      }

      return {
        body: [label, ...steps].join("\n"),
        proseBody: prose,
        artefact: { kind: "none", content: "" },
        styleWarning:
          steps.length < 2 ? "Fewer than two steps available in the source." : undefined,
      };
    }

    case "Visual_Structured": {
      const artefact = buildArtefact(topic, sentences);

      return {
        body: `${label}\n${truncateWords(prose, 120)}`,
        proseBody: prose,
        artefact,
        styleWarning:
          artefact.kind === "none"
            ? "No structured artefact could be built from the source."
            : undefined,
      };
    }
  }
}

/** The section returned for a Topic the source does not cover. */
function uncoveredSection(topic: TopicView): RecapSectionOutput {
  const notice = `The lecture material does not cover ${topic.name}.`;

  return {
    topicId: topic.topicId,
    covered: false,
    body: notice,
    proseBody: notice,
    artefact: { kind: "none", content: "" },
    unitIdxs: [],
  };
}

/**
 * Builds the Recap for one Learner_Profile.
 *
 * Exactly one section per Topic, in Topic order, so the Recap always matches the
 * Topic list the rest of the product keys on.
 */
export function buildRecap(
  corpus: IndexedCorpus,
  profile: LearnerProfileInput,
): RecapOutput {
  const sections: RecapSectionOutput[] = [];
  const takeawayCandidates: ScoredSentence[] = [];

  for (const topic of corpus.topics) {
    if (topic.sentences.length === 0) {
      sections.push(uncoveredSection(topic));
      continue;
    }

    const ranked = scoreSentences(topic.sentences, profile.understandingLevel, [
      topic.name,
    ]);

    const selected = inReadingOrder(
      ranked.slice(0, SENTENCE_BUDGET[profile.explanationStyle]),
    );

    const composed = compose(topic, selected, profile);

    sections.push({
      topicId: topic.topicId,
      covered: true,
      body: composed.body,
      proseBody: composed.proseBody,
      artefact: composed.artefact,
      unitIdxs: citedUnits(selected),
    });

    if (ranked[0]) takeawayCandidates.push(ranked[0]);
  }

  return { takeaways: buildTakeaways(corpus, profile, takeawayCandidates), sections };
}

/**
 * Key_Takeaways: one single-sentence statement per Topic, topped up from the
 * corpus when there are fewer than three Topics with content.
 */
function buildTakeaways(
  corpus: IndexedCorpus,
  profile: LearnerProfileInput,
  perTopic: readonly ScoredSentence[],
): string[] {
  const takeaways: string[] = [];
  const seen = new Set<string>();

  const add = (sentence: ScoredSentence) => {
    const text = asSentence(truncateWords(sentence.text, 30));
    const key = normalise(text);
    if (key.length === 0 || seen.has(key)) return;

    seen.add(key);
    takeaways.push(text);
  };

  for (const sentence of perTopic.slice(0, MAX_TAKEAWAYS)) add(sentence);

  if (takeaways.length < MIN_TAKEAWAYS) {
    const ranked = scoreSentences(corpus.allSentences, profile.understandingLevel);

    for (const sentence of ranked) {
      if (takeaways.length >= MIN_TAKEAWAYS) break;
      add(sentence);
    }
  }

  return takeaways.slice(0, MAX_TAKEAWAYS);
}

import "server-only";

import { parseReportSk, prefixes, reportSk, sessionPk } from "@/lib/repo/keys";
import { getItem, putItem, queryPrefix, type Item } from "@/lib/repo/table";
import type { DifficultyLevel, UnderstandingReport } from "@/lib/types";

/**
 * Persistence for Understanding_Reports.
 *
 * Every number in a report is computed by `lib/domain/mastery.ts` before it
 * reaches this module. The Learner_Id leads the sort key, so the ownership rule
 * — only the owning Learner may read their report — is enforced by which key a
 * caller is able to construct, not by filtering after a read.
 */

interface ReportItem extends Item {
  topicMastery: Record<string, number>;
  weakTopics: string[];
  highestCorrectDifficulty: DifficultyLevel | null;
  guidance: string[];
  guidanceMode: UnderstandingReport["guidanceMode"];
}

function toReport(
  learnerId: string,
  quizSessionId: string,
  item: ReportItem,
): UnderstandingReport {
  return {
    learnerId,
    quizSessionId,
    topicMastery: item.topicMastery,
    weakTopics: item.weakTopics,
    highestCorrectDifficulty: item.highestCorrectDifficulty,
    guidance: item.guidance,
    guidanceMode: item.guidanceMode,
  };
}

export async function putReport(
  sessionId: string,
  report: UnderstandingReport,
): Promise<void> {
  const item: ReportItem = {
    PK: sessionPk(sessionId),
    SK: reportSk(report.learnerId, report.quizSessionId),
    topicMastery: report.topicMastery,
    weakTopics: report.weakTopics,
    highestCorrectDifficulty: report.highestCorrectDifficulty,
    guidance: report.guidance,
    guidanceMode: report.guidanceMode,
  };

  await putItem(item);
}

export async function getReport(
  sessionId: string,
  learnerId: string,
  quizSessionId: string,
): Promise<UnderstandingReport | null> {
  const item = await getItem<ReportItem>(
    sessionPk(sessionId),
    reportSk(learnerId, quizSessionId),
  );
  return item ? toReport(learnerId, quizSessionId, item) : null;
}

/** Every Understanding_Report belonging to one Learner. */
export async function listReports(
  sessionId: string,
  learnerId: string,
): Promise<UnderstandingReport[]> {
  const items = await queryPrefix<ReportItem>(sessionId, prefixes.reports(learnerId));

  return items.flatMap((item) => {
    const parsed = parseReportSk(String(item.SK));
    if (!parsed) return [];
    return [toReport(parsed.learnerId, parsed.quizSessionId, item)];
  });
}

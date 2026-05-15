import { z } from "zod";
import type { CoachingInsightReport } from "@/lib/coaching-insight-report";
import type { PrunedTasksAnalysis } from "@/lib/pruned-analysis";

const itemSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

const excellentExampleSchema = z.object({
  prompt: z.string().min(1),
  whyExcellent: z.string().min(1),
});

export const combinedWriterReportSchema = z.object({
  environmentLabel: z.string().min(1),
  environmentSubtitle: z.string().min(1),
  section1Items: z.array(itemSchema).min(1),
  section2Items: z.array(itemSchema).min(1),
  section3Items: z.array(itemSchema).min(1),
  section4Intro: z.string().min(1),
  section4RiskItems: z.array(itemSchema).min(1),
  section4ActionItems: z.array(itemSchema).min(1),
  excellentExamples: z.array(excellentExampleSchema).length(3).optional(),
});

export type CombinedWriterReport = z.infer<typeof combinedWriterReportSchema>;

/**
 * Build one cohesive writer report by extending insights (sections 1-3)
 * with pruned-derived risk patterns + actions as section 4.
 */
export function buildCombinedWriterReport(
  insights: CoachingInsightReport,
  pruned: PrunedTasksAnalysis,
): CombinedWriterReport {
  return {
    environmentLabel: insights.environmentLabel,
    environmentSubtitle: insights.environmentSubtitle,
    section1Items: insights.section1Items,
    section2Items: insights.section2Items,
    section3Items: insights.section3Items,
    section4Intro: pruned.overview,
    section4RiskItems: pruned.commonThemes.map((t) => ({
      title: t.title,
      body: t.body,
    })),
    section4ActionItems: pruned.recommendations.map((r) => ({
      title: r.title,
      body: r.body,
    })),
    excellentExamples: insights.excellentExamples,
  };
}


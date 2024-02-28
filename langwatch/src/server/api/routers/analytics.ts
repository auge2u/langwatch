import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRACE_CHECKS_INDEX, TRACE_INDEX, esClient } from "../../elasticsearch";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import {
  sharedAnalyticsFilterInput,
  generateTraceQueryConditions,
  currentVsPreviousDates,
  generateTraceChecksQueryConditions,
} from "./analytics/common";
import { sessionsVsPreviousPeriod } from "./analytics/sessions";
import { topUsedDocuments } from "./analytics/documents";
import type { TraceCheck } from "../../tracer/types";
import { getTimeseries } from "./analytics/timeseries";
import { dataForFilter } from "./analytics/dataForFilter";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";

export const analyticsRouter = createTRPCRouter({
  getTimeseries,
  dataForFilter,
  sessionsVsPreviousPeriod,
  topUsedDocuments,
  getSummaryMetrics: protectedProcedure
    .input(sharedAnalyticsFilterInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .query(async ({ input }) => {
      const { previousPeriodStartDate } = currentVsPreviousDates(input);

      const summaryQuery = (startDate: number, endDate: number) =>
        esClient.search({
          index: TRACE_INDEX,
          body: {
            size: 0,
            query: {
              bool: {
                filter: generateTraceQueryConditions({
                  ...input,
                  startDate,
                  endDate,
                }),
              } as QueryDslBoolQuery,
            },
          },
          aggs: {
            avg_tokens_per_trace: {
              avg: {
                script: {
                  source:
                    "if (doc['metrics.prompt_tokens'].size() > 0 && doc['metrics.completion_tokens'].size() > 0) { return doc['metrics.prompt_tokens'].value + doc['metrics.completion_tokens'].value } else { return 0 }",
                },
              },
            },
            avg_total_cost_per_1000_traces: {
              avg: {
                field: "metrics.total_cost",
              },
            },
            percentile_time_to_first_token: {
              percentiles: {
                field: "metrics.first_token_ms",
                percents: [90],
              },
            },
            percentile_total_time_ms: {
              percentiles: {
                field: "metrics.total_time_ms",
                percents: [90],
              },
            },
          },
        });

      const [currentPeriod, previousPeriod] = await Promise.all([
        summaryQuery(input.startDate, input.endDate),
        summaryQuery(previousPeriodStartDate.getTime(), input.startDate),
      ]);

      const mapAggregations = ({ aggregations }: { aggregations: any }) => {
        return {
          avg_tokens_per_trace: aggregations?.avg_tokens_per_trace
            .value as number,
          avg_total_cost_per_1000_traces: aggregations
            ?.avg_total_cost_per_1000_traces.value as number,
          percentile_90th_time_to_first_token: aggregations
            ?.percentile_time_to_first_token.values["90.0"] as number,
          percentile_90th_total_time_ms: aggregations?.percentile_total_time_ms
            .values["90.0"] as number,
        };
      };

      return {
        currentPeriod: mapAggregations(currentPeriod as any),
        previousPeriod: mapAggregations(previousPeriod as any),
      };
    }),
  getTraceCheckStatusCounts: protectedProcedure
    .input(sharedAnalyticsFilterInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .query(async ({ input }) => {
      const result = await esClient.search<TraceCheck>({
        index: TRACE_CHECKS_INDEX,
        body: {
          size: 0,
          query: {
            bool: {
              filter: generateTraceChecksQueryConditions(input),
            } as QueryDslBoolQuery,
          },
          aggs: {
            status_counts: {
              terms: {
                field: "status",
              },
            },
          },
        },
      });

      const buckets: any[] | undefined = (
        result.aggregations?.status_counts as any
      )?.buckets;

      const statusCounts = buckets?.reduce((acc, bucket) => {
        acc[bucket.key] = bucket.doc_count;
        return acc;
      }, {});

      return {
        failed: (statusCounts?.failed as number) || 0,
        succeeded: (statusCounts?.succeeded as number) || 0,
      };
    }),
});

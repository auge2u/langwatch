import { DlpServiceClient } from "@google-cloud/dlp";
import { env } from "../../env.mjs";
import type { ElasticSearchSpan, Trace } from "../../server/tracer/types";
import type {
  Checks,
  TraceCheckBackendDefinition,
  TraceCheckResult,
} from "../types";
import { getDebugger } from "../../utils/logger";
import type { google } from "@google-cloud/dlp/build/protos/protos";

const debug = getDebugger("langwatch:trace_checks:piiCheck");

// Instantiates a client using the environment variable
const credentials = JSON.parse(env.GOOGLE_CREDENTIALS_JSON);
const dlp = new DlpServiceClient({ credentials });

const dlpCheck = async (
  text: string
): Promise<google.privacy.dlp.v2.IFinding[] | null | undefined> => {
  const [response] = await dlp.inspectContent({
    parent: `projects/${credentials.project_id}/locations/global`,
    inspectConfig: {
      infoTypes: [
        // TODO: allow this to be configurable by user
        { name: "PHONE_NUMBER" },
        { name: "EMAIL_ADDRESS" },
        { name: "CREDIT_CARD_NUMBER" },
        { name: "IBAN_CODE" },
        { name: "IP_ADDRESS" },
        { name: "PASSPORT" },
        { name: "VAT_NUMBER" },
        { name: "MEDICAL_RECORD_NUMBER" },
      ],
      minLikelihood: "POSSIBLE",
      limits: {
        maxFindingsPerRequest: 0, // (0 = server maximum)
      },
      // Whether to include the matching string
      includeQuote: true,
    },
    item: {
      value: text,
    },
  });

  return response.result?.findings;
};

export const piiCheck = async (
  trace: Trace,
  spans: ElasticSearchSpan[]
): Promise<{
  quotes: string[];
  traceFindings: google.privacy.dlp.v2.IFinding[];
  spansFindings: google.privacy.dlp.v2.IFinding[];
}> => {
  debug("Checking PII for trace", trace.id);

  const traceText = [
    trace.input.value,
    trace.output?.value ?? "",
    trace.error?.message ?? "",
    trace.error?.stacktrace ?? "",
  ].join("\n\n");
  const spansText = spans
    .flatMap((span) =>
      [span.input?.value ?? "", span.error?.message ?? ""]
        .concat(span.outputs.map((x) => x.value))
        .concat(span.error?.stacktrace ?? [])
    )
    .join("\n\n");

  const traceFindings = (await dlpCheck(traceText)) ?? [];
  const spansFindings = (await dlpCheck(spansText)) ?? [];
  const allFindings = traceFindings.concat(spansFindings);

  const quotes = allFindings.map((finding) => finding.quote!).filter((x) => x);
  for (const finding of allFindings) {
    finding.quote = "REDACTED"; // prevent storing quote in ES
  }

  return {
    quotes,
    traceFindings,
    spansFindings,
  };
};

export const convertToTraceCheckResult = (
  {
    traceFindings,
    spansFindings,
  }: {
    traceFindings: google.privacy.dlp.v2.IFinding[];
    spansFindings: google.privacy.dlp.v2.IFinding[];
  },
  parameters: Checks["pii_check"]["parameters"]
): TraceCheckResult => {
  const infoTypes = Object.entries(parameters.infoTypes ?? {})
    .filter(([_key, value]) => value)
    .map(([key]) => key);
  const likelihoodIncluded = (likelihood: string) => {
    const likelihoods = [
      "VERY_UNLIKELY",
      "UNLIKELY",
      "POSSIBLE",
      "LIKELY",
      "VERY_LIKELY",
    ];
    return (
      likelihoods.indexOf(likelihood) >=
      likelihoods.indexOf(parameters.minLikelihood ?? "POSSIBLE")
    );
  };
  const filteredTraces = traceFindings.filter(
    (finding) =>
      finding.infoType?.name &&
      infoTypes.includes(finding.infoType?.name) &&
      likelihoodIncluded(finding.likelihood?.toString() ?? "POSSIBLE")
  );
  const filteredSpans = traceFindings.filter(
    (finding) =>
      finding.infoType?.name &&
      infoTypes.includes(finding.infoType?.name) &&
      likelihoodIncluded(finding.likelihood?.toString() ?? "POSSIBLE")
  );

  const allFindings = filteredTraces.concat(filteredSpans);
  const reportedFindings = parameters?.checkPiiInSpans
    ? allFindings
    : filteredTraces;

  return {
    raw_result: {
      traceFindings,
      spansFindings,
    },
    value: reportedFindings.length,
    status: reportedFindings.length > 0 ? "failed" : "succeeded",
  };
};

const execute = async (
  trace: Trace,
  spans: ElasticSearchSpan[],
  parameters: Checks["pii_check"]["parameters"]
): Promise<TraceCheckResult> => {
  const results = await piiCheck(trace, spans);

  return convertToTraceCheckResult(results, parameters);
};

export const PIICheck: TraceCheckBackendDefinition<"pii_check"> = {
  execute,
};

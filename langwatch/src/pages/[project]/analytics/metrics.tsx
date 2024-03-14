import {
  Card,
  CardBody,
  CardHeader,
  Container,
  GridItem,
  HStack,
  Heading,
  SimpleGrid,
  Spacer,
} from "@chakra-ui/react";
import GraphsLayout from "~/components/GraphsLayout";
import { PeriodSelector, usePeriodSelector } from "~/components/PeriodSelector";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import {
  FilterToggle,
  useFilterToggle,
} from "~/components/filters/FilterToggle";

const userCount = {
  graphId: "custom",
  graphType: "summary",
  series: [
    {
      name: "",
      colorSet: "blueTones",
      metric: "metadata.user_id",
      aggregation: "cardinality",
    },
  ],
  includePrevious: true,
  timeScale: 1,
  height: 550,
};

const LLMMetrics = {
  graphId: "custom",
  graphType: "summary",
  series: [
    {
      name: "LLM Calls",
      metric: "metadata.span_type",
      key: "llm",
      aggregation: "cardinality",
      colorSet: "colors",
    },
    {
      name: "Total cost",
      colorSet: "greenTones",
      metric: "performance.total_cost",
      aggregation: "sum",
    },
    {
      name: "Total tokens",
      colorSet: "purpleTones",
      metric: "performance.total_tokens",
      aggregation: "sum",
    },
  ],
  includePrevious: false,
  timeScale: 1,
  height: 300,
};

const LLMSummary = {
  graphId: "custom",
  graphType: "summary",
  series: [
    {
      name: "Average tokens per message",
      colorSet: "colors",
      metric: "performance.total_tokens",
      aggregation: "avg",
    },
    {
      name: "Average cost per message",
      colorSet: "greenTones",
      metric: "performance.total_cost",
      aggregation: "avg",
    },
    {
      name: "90th Percentile time to first token",
      colorSet: "cyanTones",
      metric: "performance.first_token",
      aggregation: "p90",
    },
    {
      name: "90th Percentile completion time",
      colorSet: "greenTones",
      metric: "performance.completion_time",
      aggregation: "p90",
    },
  ],
  includePrevious: false,
  timeScale: 1,
  height: 300,
};

const LLMs = {
  graphId: "custom",
  graphType: "area",
  series: [
    {
      name: "90th Percentile Completion Time",
      colorSet: "colors",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
    },
  ],
  groupBy: "metadata.model",
  includePrevious: false,
  timeScale: 1,
  height: 300,
};

const llmUsage = {
  graphId: "custom",
  graphType: "donnut",
  series: [
    {
      name: "90th Percentile Completion Time",
      colorSet: "colors",
      metric: "metadata.span_type",
      aggregation: "cardinality",
      key: "llm",
    },
  ],
  groupBy: "metadata.model",
  includePrevious: false,
  timeScale: 1,
  height: 300,
};

const completionTime = {
  graphId: "custom",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Completion time average",
      colorSet: "colors",
      metric: "performance.completion_time",
      aggregation: "avg",
    },
  ],
  groupBy: "metadata.model",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

const totalCostPerModel = {
  graphId: "custom",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Average total cost average per message",
      colorSet: "colors",
      metric: "performance.total_cost",
      aggregation: "avg",
      pipeline: {
        field: "trace_id",
        aggregation: "avg",
      },
    },
  ],
  groupBy: "metadata.model",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

const averageTokensPerMessage = {
  graphId: "custom",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Average completion tokens average per message",
      colorSet: "colors",
      metric: "performance.completion_tokens",
      aggregation: "avg",
      pipeline: {
        field: "trace_id",
        aggregation: "avg",
      },
    },
  ],
  groupBy: "metadata.model",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

export default function Users() {
  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();
  const { showFilters } = useFilterToggle();

  return (
    <GraphsLayout>
      <Container maxWidth={showFilters ? "1300" : "1200"} padding={6}>
        <HStack width="full" marginBottom={3}>
          <Spacer />
          <FilterToggle />
          <PeriodSelector
            period={{ startDate, endDate }}
            setPeriod={setPeriod}
          />
        </HStack>
        <hr />
        <HStack paddingY={2}>
          <SimpleGrid
            templateColumns="repeat(4, 1fr)"
            gap={5}
            marginTop={4}
            width={"100%"}
          >
            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardHeader>
                  <Heading size="sm">LLM Metrics</Heading>
                </CardHeader>
                <CardBody>
                  <CustomGraph input={LLMMetrics as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardHeader>
                  <Heading size="sm">Summary</Heading>
                </CardHeader>
                <CardBody>
                  <CustomGraph input={LLMSummary as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>

            <GridItem colSpan={4} display={"inline-grid"}>
              <Card>
                <CardHeader>
                  <Heading size="sm">LLM Usage</Heading>
                </CardHeader>
                <CardBody>
                  <CustomGraph input={LLMs as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardHeader>
                  <Heading size="sm">LLM Split</Heading>
                </CardHeader>
                <CardBody>
                  <CustomGraph input={llmUsage as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardHeader>
                  <Heading size="sm">Average Completion Time</Heading>
                </CardHeader>
                <CardBody>
                  <CustomGraph input={completionTime as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardHeader>
                  <Heading size="sm">Average Cost Per Message</Heading>
                </CardHeader>
                <CardBody>
                  <CustomGraph input={totalCostPerModel as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardHeader>
                  <Heading size="sm">Average Tokens Per Message</Heading>
                </CardHeader>
                <CardBody>
                  <CustomGraph
                    input={averageTokensPerMessage as CustomGraphInput}
                  />
                </CardBody>
              </Card>
            </GridItem>
          </SimpleGrid>
        </HStack>
      </Container>
    </GraphsLayout>
  );
}

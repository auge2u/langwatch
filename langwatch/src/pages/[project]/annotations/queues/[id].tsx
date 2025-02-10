import { Container, Heading } from "@chakra-ui/react";

import { useRouter } from "next/router";

import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
export default function Annotations() {
  const router = useRouter();

  const { id } = router.query;

  const {
    memberAccessibleQueueItemsWithTraces,

    queuesLoading,
  } = useAnnotationQueues();

  const allQueueItems = [
    ...(memberAccessibleQueueItemsWithTraces?.filter(
      (item) => item.annotationQueueId === id
    ) ?? []),
  ];

  return (
    <AnnotationsLayout>
      <Container maxWidth={"calc(100vw - 320px)"} padding={6}>
        <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
          Annotations
        </Heading>
        <Heading as={"h4"} size="md" fontWeight="normal">
          Inbox
        </Heading>

        <AnnotationsTable
          allQueueItems={allQueueItems}
          queuesLoading={queuesLoading}
        />
      </Container>
    </AnnotationsLayout>
  );
}

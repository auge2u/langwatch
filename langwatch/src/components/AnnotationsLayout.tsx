import {
  Avatar,
  Badge,
  Divider,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { type PropsWithChildren } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";
import { Check, Edit, Inbox, Users } from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { useRouter } from "next/router";
import { usePeriodSelector } from "./PeriodSelector";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";

export default function AnnotationsLayout({
  children,
  isSubscription,
}: PropsWithChildren<{ isSubscription?: boolean }>) {
  const { data: session } = useRequiredSession();
  const user = session?.user;
  const { project } = useOrganizationTeamProject();

  const {
    assignedQueueItemsWithTraces,
    memberAccessibleQueueItemsWithTraces,
    memberAccessibleQueues,
    doneQueueItemsWithTraces,
  } = useAnnotationQueues();

  const totalItems =
    (assignedQueueItemsWithTraces?.length ?? 0) +
    (memberAccessibleQueueItemsWithTraces?.length ?? 0);

  const menuItems = {
    inbox: <Inbox width={20} height={20} />,
    queues: <Users width={20} height={20} />,
    myQueues: (
      <Avatar name={user?.name ?? ""} width={5} height={5} size="2xs" />
    ),
    all: <Edit width={20} height={20} />,
    done: <Check width={20} height={20} />,
  };

  const router = useRouter();
  const id = router.query.id;

  return (
    <DashboardLayout>
      <HStack align="start" width="full" height="full">
        <VStack
          align="start"
          background="white"
          paddingY={5}
          borderRightWidth="1px"
          borderColor="gray.300"
          fontSize="14px"
          minWidth="240px"
          height="full"
          spacing={1}
          display={isSubscription ? "none" : "flex"}
        >
          <Text fontSize="md" fontWeight="500" paddingX={4} paddingY={2}>
            Annotations
          </Text>
          <MenuLink
            href={`/${project?.slug}/annotations`}
            icon={menuItems.all}
            isSelectedAnnotation={router.pathname === "/[project]/annotations"}
          >
            All
          </MenuLink>
          <MenuLink
            href={`/${project?.slug}/annotations/inbox`}
            icon={menuItems.inbox}
            menuEnd={
              <Text fontSize="xs" fontWeight="500">
                {totalItems > 0 ? totalItems : ""}
              </Text>
            }
            isSelectedAnnotation={
              router.pathname === "/[project]/annotations/inbox"
            }
          >
            Inbox
          </MenuLink>
          <MenuLink
            href={`/${project?.slug}/annotations/users/me`}
            isSelectedAnnotation={
              router.pathname === "/[project]/annotations/users/me"
            }
            icon={menuItems.myQueues}
            menuEnd={
              <Text fontSize="xs" fontWeight="500">
                {(assignedQueueItemsWithTraces?.length ?? 0) > 0
                  ? assignedQueueItemsWithTraces?.length
                  : ""}
              </Text>
            }
          >
            {user?.name?.split(" ")[0]} (You)
          </MenuLink>
          <MenuLink
            href={`/${project?.slug}/annotations/done`}
            icon={menuItems.done}
            isSelectedAnnotation={
              router.pathname === "/[project]/annotations/done"
            }
          >
            Done
          </MenuLink>
          <Divider />
          <Text fontSize="sm" fontWeight="500" paddingX={4} paddingY={2}>
            My Queues
          </Text>
          {memberAccessibleQueues?.map((queue) => (
            <MenuLink
              key={queue.id}
              href={`/${project?.slug}/annotations/queues/${queue.id}`}
              isSelectedAnnotation={
                router.pathname ===
                `/${project?.slug}/annotations/queues/${queue.id}`
              }
              icon={menuItems.queues}
              menuEnd={
                <Text fontSize="xs" fontWeight="500">
                  {queue.AnnotationQueueItems.length > 0
                    ? queue.AnnotationQueueItems.length
                    : ""}
                </Text>
              }
            >
              {queue.name}
            </MenuLink>
          ))}
        </VStack>
        {children}
      </HStack>
    </DashboardLayout>
  );
}

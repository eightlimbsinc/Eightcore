import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskModal } from "@/components/tasks/task-modal";

/** A task link followed inside the app opens the task in a window over the current page. */
export default async function TaskWindow({ params }: { params: Promise<{ slug: string; ref: string }> }) {
  const { slug, ref } = await params;
  const reference = decodeURIComponent(ref).toUpperCase();
  return (
    <TaskModal title={`Task ${reference}`}>
      <TaskDetail slug={slug} reference={ref} variant="modal" />
    </TaskModal>
  );
}

import type { Metadata } from "next";
import { TaskDetail } from "@/components/tasks/task-detail";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  return { title: decodeURIComponent((await params).ref).toUpperCase() };
}

export default async function TaskPage({ params }: { params: Promise<{ slug: string; ref: string }> }) {
  const { slug, ref } = await params;
  return <TaskDetail slug={slug} reference={ref} />;
}

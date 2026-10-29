-- A "closed" status category (like ClickUp's Closed): finished tasks that lists hide unless
-- "Closed" is turned on. The enum is rebuilt rather than extended (ALTER TYPE ... ADD VALUE),
-- because a value added that way can't be used later in the same transaction.
ALTER TYPE "public"."status_category" RENAME TO "status_category_old";--> statement-breakpoint
CREATE TYPE "public"."status_category" AS ENUM('backlog', 'unstarted', 'active', 'review', 'done', 'cancelled', 'closed');--> statement-breakpoint
ALTER TABLE "list_statuses" ALTER COLUMN "category" TYPE "public"."status_category" USING "category"::text::"public"."status_category";--> statement-breakpoint
DROP TYPE "public"."status_category_old";--> statement-breakpoint
-- Every existing list gets a "Completed" status at the end (positions are fractional keys:
-- appending a letter to the current last key sorts after it).
INSERT INTO "list_statuses" ("workspace_id", "list_id", "name", "category", "color", "position")
SELECT l."workspace_id", l."id", 'Completed', 'closed', '#6B7280', coalesce(max(s."position"), 'a0') || 'V'
  FROM "task_lists" l
  LEFT JOIN "list_statuses" s ON s."list_id" = l."id"
 WHERE NOT EXISTS (SELECT 1 FROM "list_statuses" c WHERE c."list_id" = l."id" AND c."category" = 'closed')
 GROUP BY l."workspace_id", l."id";

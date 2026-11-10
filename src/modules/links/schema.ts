// Website previews for links in comments and descriptions, fetched once and cached.
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const linkPreviews = pgTable("link_previews", {
  url: text().primaryKey(),
  /** False when the page couldn't be read (retried after a day). */
  ok: boolean().notNull(),
  title: text(),
  description: text(),
  imageUrl: text(),
  siteName: text(),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";

const outbox = path.resolve(".mail/e2e");

/** Waits for the newest email to `to` and returns the first link in it. */
export async function linkFromLatestMail(to: string, subjectIncludes: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const files = (await readdir(outbox).catch(() => [] as string[])).sort().reverse();
        for (const file of files) {
          const mail = JSON.parse(await readFile(path.join(outbox, file), "utf8")) as {
            to: string;
            subject: string;
            text: string;
          };
          if (mail.to === to && mail.subject.includes(subjectIncludes)) {
            link = mail.text.match(/https?:\/\/\S+/)?.[0];
            return Boolean(link);
          }
        }
        return false;
      },
      { message: `waiting for "${subjectIncludes}" mail to ${to}`, timeout: 10_000 },
    )
    .toBe(true);
  return link!;
}

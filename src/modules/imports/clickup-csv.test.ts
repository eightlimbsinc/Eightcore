import { describe, expect, it } from "vitest";
import {
  matchPerson,
  parseClickUpDate,
  parseClickUpPeople,
  parseClickUpPriority,
  parseCsv,
  readClickUpExport,
} from "./clickup-csv";

describe("ClickUp CSV export", () => {
  it("parses quoted fields, embedded commas and quotes, and CRLF", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });

  it("reads ClickUp dates, priorities and people", () => {
    expect(parseClickUpDate("Wednesday, August 5th 2026")).toBe("2026-08-05");
    expect(parseClickUpDate("Monday, June 1st 2026")).toBe("2026-06-01");
    expect(parseClickUpDate("")).toBeNull();
    expect(() => parseClickUpDate("Friday, February 30th 2026")).toThrow();
    expect(parseClickUpPriority("HIGH")).toBe("high");
    expect(parseClickUpPriority("none")).toBe("none");
    expect(parseClickUpPeople("[Nelfredo Bangkas, Edward caburnay]")).toEqual([
      "Nelfredo Bangkas",
      "Edward caburnay",
    ]);
    expect(parseClickUpPeople("[]")).toEqual([]);
  });

  it("uses the known columns and reports the ignored ones", () => {
    const csv = [
      '"Task ID","Task Name","Assignee","QA Estimate /days (number)","Due Date","Priority","Date Created"',
      '"86e0","[ADA Audit] Home","[Mark]",1,"Thursday, August 6th 2026","LOW","Monday, March 30th 2026, 10:01:06 pm +08:00"',
    ].join("\n");
    const { tasks, ignoredColumns } = readClickUpExport(csv);
    expect(tasks).toEqual([
      {
        clickUpId: "86e0",
        title: "[ADA Audit] Home",
        assignees: ["Mark"],
        dueDate: "2026-08-06",
        priority: "low",
        createdLabel: "Monday, March 30th 2026, 10:01:06 pm +08:00",
      },
    ]);
    expect(ignoredColumns).toEqual(["QA Estimate /days (number)"]);
  });

  it("matches people by full name, or by a unique first name", () => {
    const people = [{ name: "Mark Reyes" }, { name: "Edward Caburnay" }, { name: "Jean Khaye Cabiscuelas" }];
    expect(matchPerson("Edward caburnay", people)?.name).toBe("Edward Caburnay");
    expect(matchPerson("Mark", people)?.name).toBe("Mark Reyes");
    expect(matchPerson("Jean", people)?.name).toBe("Jean Khaye Cabiscuelas");
    expect(matchPerson("Nobody", people)).toBeUndefined();
    expect(matchPerson("Mark", [...people, { name: "Mark Twain" }])).toBeUndefined();
  });
});

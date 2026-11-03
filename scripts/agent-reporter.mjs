import { relative } from "node:path";
import { inspect } from "node:util";

export default async function* (events) {
  for await (const { type, data } of events) {
    if (type === "test:stderr") yield data.message;

    if (type === "test:fail" && data.details.error?.failureType !== "subtestsFailed") {
      const location = data.file ? `${relative(process.cwd(), data.file)}:${data.line ?? 1}` : "";
      const error = data.details.error;
      yield `FAIL ${data.name} ${location}\n${inspect(error?.cause ?? error, { colors: false })}\n`;
    }

    if (type === "test:summary" && !data.file) {
      const { counts } = data;
      const result = counts.failed || counts.cancelled ? "FAIL" : "PASS";
      const extra = ["failed", "cancelled", "skipped", "todo"]
        .filter((key) => counts[key])
        .map((key) => `${counts[key]} ${key}`);
      yield `${result} ${counts.passed}/${counts.tests} tests${extra.length ? `, ${extra.join(", ")}` : ""}\n`;
    }
  }
}

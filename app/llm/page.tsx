import { redirect } from "next/navigation";

export default function LegacyLlmPage() {
  redirect("/configuration/llm");
}

import Link from "next/link";

const items = [
  { href: "/reports/insights", label: "Insights", id: "insights" },
  { href: "/reports/dataset-qa", label: "Dataset Q&A", id: "dataset-qa" },
  { href: "/reports/pruned-analysis", label: "Pruned analysis", id: "pruned" },
  { href: "/reports/combined", label: "Combined", id: "combined" },
] as const;

export function ReportsSubnav(props: {
  active: "insights" | "dataset-qa" | "pruned" | "combined";
}) {
  return (
    <div className="mx-auto mt-6 flex w-full max-w-5xl flex-wrap gap-2 px-5">
      {items.map((item) => {
        const selected = item.id === props.active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={selected ? "page" : undefined}
            className={`rounded-full border px-4 py-2 text-sm transition ${
              selected
                ? "border-amber-700/80 bg-amber-900/20 text-amber-200"
                : "border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

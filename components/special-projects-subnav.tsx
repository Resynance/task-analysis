import Link from "next/link";

const items = [
  { href: "/special-projects/openclaw", label: "Overview", id: "openclaw" },
  {
    href: "/special-projects/openclaw/run",
    label: "Run export",
    id: "openclaw-run",
  },
  {
    href: "/special-projects/openclaw/analyze",
    label: "Run analysis",
    id: "openclaw-analyze",
  },
  {
    href: "/special-projects/openclaw/writer-precheck",
    label: "Writer pre-check",
    id: "openclaw-writer-precheck",
  },
] as const;

export type SpecialProjectsOpenclawNav = (typeof items)[number]["id"];

export function SpecialProjectsSubnav(props: {
  active: SpecialProjectsOpenclawNav;
}) {
  return (
    <div className="mx-auto mt-6 flex w-full max-w-5xl flex-wrap gap-2 px-5 print:hidden">
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

import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";

interface Props {
  title: string;
  subtitle: string;
  description: string;
  features: string[];
}

export function StubView({ title, subtitle, description, features }: Props) {
  usePageHeader(<PageHeaderContent title={title} subtitle={subtitle} />);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6">
        <div className="card mx-auto max-w-2xl p-8">
          <div className="mb-2 text-xs uppercase tracking-wider text-ink-500">
            Coming soon
          </div>
          <h2 className="mb-3 text-xl font-semibold text-ink-900">
            Web port of {title} is in progress
          </h2>
          <p className="mb-5 text-sm text-ink-600">{description}</p>
          <div className="label mb-2">Planned features</div>
          <ul className="space-y-1.5 text-sm text-ink-700">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <span className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ink-400" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600">
            The desktop app still exposes this feature — run{" "}
            <span className="kbd">python main.py</span> from the project root.
          </div>
        </div>
      </div>
    </div>
  );
}

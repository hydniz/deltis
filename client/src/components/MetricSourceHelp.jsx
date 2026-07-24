// A help icon that reveals what a metric actually measures — its original
// (template) name and a plain-language explanation — so a user who renamed the
// metric still knows which value sits behind it, and where it comes from.
//
// `metric.source` is set by the server (services/metricCatalog.templateInfo)
// for metrics seeded from a catalog template; hand-made metrics have none, in
// which case nothing is rendered.
import { HelpTip } from './ui';

export default function MetricSourceHelp({ metric, size = 13 }) {
  const source = metric?.source;
  if (!source) return null;

  const renamed = source.name && metric.name !== source.name;
  const short = renamed ? `Basiert auf „${source.name}“` : source.description;

  return (
    <HelpTip title={source.name || metric.name} short={short} size={size}>
      <p>{source.description}</p>
      {renamed && (
        <p>
          Dieser Messwert basiert auf <strong>{source.name}</strong> — du hast ihn nur umbenannt.
        </p>
      )}
      {source.healthType ? (
        <p>
          Quelle: <strong>Health Connect</strong> (<code>{source.healthType}</code>). Verbinde die
          Deltis-Companion-App, damit dieser Wert automatisch übertragen wird.
        </p>
      ) : (
        <p>Diesen Wert trägst du selbst ein.</p>
      )}
    </HelpTip>
  );
}

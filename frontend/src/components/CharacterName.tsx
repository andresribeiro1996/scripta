export function CharacterName({ name, className }: { name: string; className: string }) {
  return (
    <span className={`flex min-w-0 flex-col font-bold text-(--color-accent) ${className}`}>
      {name.split(/\s+/).slice(0, 4).map((word, i) => (
        <span key={i} className="block truncate">{word}</span>
      ))}
    </span>
  );
}

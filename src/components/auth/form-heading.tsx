export function FormHeading({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="mb-8 grid gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="text-muted-foreground">{description}</p> : null}
    </div>
  );
}

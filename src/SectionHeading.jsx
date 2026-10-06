export default function SectionHeading({
  icon: Icon,
  tone = "teal",
  children,
  level = 2,
}) {
  const Heading = `h${level}`;
  return (
    <div className={`card-heading tone-${tone}`}>
      <span className="section-icon" aria-hidden="true">
        <Icon size={26} strokeWidth={1.8} />
      </span>
      <Heading>{children}</Heading>
    </div>
  );
}

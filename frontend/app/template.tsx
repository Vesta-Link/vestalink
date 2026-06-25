export default function Template({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="animate-fade-in">{children}</div>;
}

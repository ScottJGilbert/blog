export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

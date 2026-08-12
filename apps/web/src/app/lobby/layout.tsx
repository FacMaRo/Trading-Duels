import { Suspense } from 'react';

export default function LobbyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="py-20 text-center text-muted-foreground">
          Loading lobby…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

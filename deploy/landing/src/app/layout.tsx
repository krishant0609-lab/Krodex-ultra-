export const metadata = {
  title: 'KRODEX v1.0',
  description: 'KRODEX study management — production ready',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0b1020', color: '#e7ecf3', minHeight: '100vh' }}>
        {children}
      </body>
    </html>
  );
}

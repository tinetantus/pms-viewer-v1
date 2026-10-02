import type { Metadata } from 'next';
import './globals.css';
import { DialogAccessibility } from '@/components/dialog-accessibility';

export const metadata: Metadata = {
  title: 'Packaging Proof',
  description: 'Internal packaging artwork review workspace',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <DialogAccessibility />
        {children}
      </body>
    </html>
  );
}

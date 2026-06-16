import type { Metadata } from 'next';
import { Poppins, Hind_Siliguri, Tiro_Bangla } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/context/ToastContext';
import { ConfirmProvider } from '@/context/ConfirmContext';

const poppins = Poppins({
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-poppins',
  display: 'swap',
});

const hindSiliguri = Hind_Siliguri({
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['bengali'],
  variable: '--font-hind',
  display: 'swap',
});

const tiroBangla = Tiro_Bangla({
  weight: ['400'],
  subsets: ['bengali'],
  variable: '--font-tiro',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Chuti - Leave Management System',
  description: 'Enterprise-grade Local Leave Management System for Bangladeshi Companies & Institutes',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html 
      lang="bn" 
      className={`${poppins.variable} ${hindSiliguri.variable} ${tiroBangla.variable}`}
    >
      <body>
        <ToastProvider>
          <ConfirmProvider>
            {children}
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AuthSessionProvider } from "@/components/auth-session";
import { SentinelStreamProvider } from "@/components/sentinel-stream";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Sentinel",
  description: "Personal market intelligence and trading discipline",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <AuthSessionProvider>
          <SentinelStreamProvider>
            <div className="min-h-screen">
              <AppHeader />
              <main className="px-6 py-6">{children}</main>
            </div>
          </SentinelStreamProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}

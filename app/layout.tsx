import type { Metadata, Viewport } from "next";
import "@/ui/globals.css";

export const metadata: Metadata = {
  title: "Assessoria 3.0 · Intelligence Platform",
  description: "Renovacions, CRM i intel·ligència energètica (SIPS) en una sola plataforma",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.png", apple: "/icon.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#15803d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ca" suppressHydrationWarning>
      <head>
        {/* apply saved theme before paint to avoid a flash */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('rip:theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

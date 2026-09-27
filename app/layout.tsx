import type { Metadata, Viewport } from "next";
import { Heebo, Rubik, Secular_One } from "next/font/google";
import Script from "next/script";
import { AppHeader } from "./_components/AppHeader";
import { THEME_INIT_SCRIPT } from "./_components/theme";
import "./globals.css";

// Hebrew-capable fonts (Geist has no Hebrew). Light theme: Secular One for
// headings + Rubik for text. Dark theme: Heebo for both.
const secular = Secular_One({
  variable: "--font-secular",
  subsets: ["hebrew", "latin"],
  weight: "400",
  display: "swap",
});

const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SquadLock",
  description: "לתאם מפגשים עם החברים שלך.",
};

export const viewport: Viewport = {
  themeColor: "#ffede3",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the inline script below sets data-theme
    // before React runs, so the attribute may differ from the server HTML.
    <html
      lang="he"
      dir="rtl"
      data-theme="light"
      suppressHydrationWarning
      className={`${secular.variable} ${rubik.variable} ${heebo.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col overflow-x-hidden">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <div className="sl-glows" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <AppHeader />
        <main className="safe-bottom relative z-[1] flex flex-1 flex-col">
          {children}
        </main>
      </body>
    </html>
  );
}

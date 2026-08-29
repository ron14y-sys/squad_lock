import { Unbounded, Work_Sans } from "next/font/google";
import { PreferenceGame } from "./PreferenceGame";

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin"],
  weight: ["700", "900"],
});

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export default function PreferencesPage() {
  return (
    <div className={`${unbounded.variable} ${workSans.variable} flex flex-1`}>
      <PreferenceGame />
    </div>
  );
}

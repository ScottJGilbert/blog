import Navbar from "@/components/site/Navbar";
// import CookieBanner from "@/components/site/CookieBanner";
import Footer from "@/components/site/Footer";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 antialiased">
      <Navbar />
      <main>{children}</main>
      <Footer />

      {/* <CookieBanner /> */}
    </div>
  );
}

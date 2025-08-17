// app/layout.tsx （customers）
import "./globals.css";
import Providers from "@/components/ui/providers";
import CustomerHeader from "@/components/CustomerHeader";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <Providers>
          <CustomerHeader />
          <div className="pt-14">{children}</div>
        </Providers>
      </body>
    </html>
  );
}

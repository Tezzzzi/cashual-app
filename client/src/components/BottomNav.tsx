import { Home, List, BarChart3, Users, Settings, Briefcase, Sparkles } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useLanguage } from "@/contexts/LanguageContext";

export default function BottomNav() {
  const [location] = useLocation();
  const { t } = useLanguage();

  const navItems = [
    { path: "/", icon: Home, label: t("nav_home") },
    { path: "/transactions", icon: List, label: t("nav_transactions") },
    { path: "/reports", icon: BarChart3, label: t("nav_reports") },
    { path: "/ai", icon: Sparkles, label: t("nav_ai") },
    { path: "/family", icon: Users, label: t("nav_family") },
    { path: "/business", icon: Briefcase, label: t("nav_business") },
    { path: "/settings", icon: Settings, label: t("nav_settings") },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 safe-bottom"
      style={{
        background: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        borderTop: '1px solid rgba(60, 60, 67, 0.06)',
      }}
    >
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
        {navItems.map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all duration-200 ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <div className={`relative ${isActive ? 'scale-110' : ''} transition-transform duration-200`}>
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 1.8} />
              </div>
              <span className={`text-[9px] font-medium leading-none tracking-wide ${isActive ? 'opacity-100' : 'opacity-60'}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

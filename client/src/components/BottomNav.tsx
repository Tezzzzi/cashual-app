import { Home, List, BarChart3, Users, Settings } from "lucide-react";
import { useLocation, Link } from "wouter";

const navItems = [
  { path: "/", icon: Home, label: "Главная" },
  { path: "/transactions", icon: List, label: "Записи" },
  { path: "/reports", icon: BarChart3, label: "Отчёты" },
  { path: "/family", icon: Users, label: "Семья" },
  { path: "/settings", icon: Settings, label: "Ещё" },
];

export default function BottomNav() {
  const [location] = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border safe-bottom">
      <div className="flex items-center justify-around h-14 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-medium leading-none">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Download,
  ArrowUpCircle,
  ArrowDownCircle,
  Wallet,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

type Period = "week" | "month" | "year" | "all";
type Scope = "mine" | "partner" | "all";

function getPeriodRange(period: Period): { startDate?: number; endDate?: number } {
  if (period === "all") return {};
  const now = Date.now();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  let startMs: number;
  switch (period) {
    case "week":
      startMs = now - 7 * MS_PER_DAY;
      break;
    case "month":
      startMs = now - 30 * MS_PER_DAY;
      break;
    case "year":
      startMs = now - 365 * MS_PER_DAY;
      break;
    default:
      return {};
  }
  return { startDate: startMs, endDate: now };
}

export default function Reports() {
  const { isAuthenticated } = useAuth();
  const { t, translateCategory } = useLanguage();
  const [period, setPeriod] = useState<Period>("all");
  const [reportType, setReportType] = useState<"expense" | "income">("expense");
  const [scope, setScope] = useState<Scope>("mine");

  // Fetch family groups to determine if user has a family
  const { data: familyGroups } = trpc.family.myGroups.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const hasFamily = (familyGroups?.length ?? 0) > 0;
  const familyGroupId = hasFamily ? familyGroups![0].group.id : undefined;

  const range = useMemo(() => getPeriodRange(period), [period]);

  // Build query params — include familyGroupId and scope only when viewing family reports
  const summaryParams = useMemo(() => {
    const base = { ...range };
    if (hasFamily && scope !== "mine") {
      return { ...base, familyGroupId, scope };
    }
    return base;
  }, [range, hasFamily, scope, familyGroupId]);

  const byCategoryParams = useMemo(() => {
    const base = { ...range, type: reportType };
    if (hasFamily && scope !== "mine") {
      return { ...base, familyGroupId, scope };
    }
    return base;
  }, [range, reportType, hasFamily, scope, familyGroupId]);

  const { data: summary, isLoading: summaryLoading } =
    trpc.reports.summary.useQuery(summaryParams, { enabled: isAuthenticated });

  const { data: byCategory, isLoading: catLoading } =
    trpc.reports.byCategory.useQuery(byCategoryParams, { enabled: isAuthenticated });

  const exportCsv = trpc.reports.exportCsv.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", data.filename);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("CSV экспортирован");
    },
    onError: (err) => toast.error(err.message),
  });

  const pieData = useMemo(() => {
    if (!byCategory) return [];
    return byCategory.map((c) => ({
      name: translateCategory(c.categoryName || "Другое"),
      value: parseFloat(c.total || "0"),
      color: c.categoryColor || "#6366f1",
      icon: c.categoryIcon || "📦",
    }));
  }, [byCategory, translateCategory]);

  const totalForType = useMemo(
    () => pieData.reduce((sum, d) => sum + d.value, 0),
    [pieData]
  );

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">{t("login_to_view")}</p>
      </div>
    );
  }

  const periods: { key: Period; label: string }[] = [
    { key: "week", label: t("week") },
    { key: "month", label: t("month") },
    { key: "year", label: t("year") },
    { key: "all", label: t("all_time") },
  ];

  const scopes: { key: Scope; label: string }[] = [
    { key: "mine", label: t("scope_personal") },
    { key: "partner", label: t("scope_partner") },
    { key: "all", label: t("scope_all") },
  ];

  return (
    <div className="px-4 pt-4 space-y-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t("reports_title")}</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportCsv.mutate(range)}
          disabled={exportCsv.isPending}
        >
          {exportCsv.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <Download className="h-3.5 w-3.5 mr-1" />
              {t("export_csv")}
            </>
          )}
        </Button>
      </div>

      {/* Period Selector */}
      <div className="flex gap-1.5">
        {periods.map((p) => (
          <Button
            key={p.key}
            variant={period === p.key ? "default" : "outline"}
            size="sm"
            className="flex-1 text-xs"
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Family Scope Selector — only shown when user has a family group */}
      {hasFamily && (
        <div className="tg-card">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold text-muted-foreground">
              {t("family_report_label")}
            </span>
          </div>
          <div className="flex gap-1.5">
            {scopes.map((s) => (
              <Button
                key={s.key}
                variant={scope === s.key ? "default" : "outline"}
                size="sm"
                className={`flex-1 text-xs ${scope === s.key ? "bg-primary text-primary-foreground" : ""}`}
                onClick={() => setScope(s.key)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="tg-card text-center">
          <ArrowUpCircle className="h-5 w-5 text-income mx-auto mb-1" />
          <p className="text-[10px] text-muted-foreground">{t("income")}</p>
          <p className="text-sm font-bold text-income">
            {summaryLoading
              ? "..."
              : (summary?.totalIncome ?? 0).toLocaleString("ru-RU", {
                  minimumFractionDigits: 0,
                })}
          </p>
        </div>
        <div className="tg-card text-center">
          <ArrowDownCircle className="h-5 w-5 text-expense mx-auto mb-1" />
          <p className="text-[10px] text-muted-foreground">{t("expenses")}</p>
          <p className="text-sm font-bold text-expense">
            {summaryLoading
              ? "..."
              : (summary?.totalExpense ?? 0).toLocaleString("ru-RU", {
                  minimumFractionDigits: 0,
                })}
          </p>
        </div>
        <div className="tg-card text-center">
          <Wallet className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-[10px] text-muted-foreground">{t("balance")}</p>
          <p className="text-sm font-bold">
            {summaryLoading
              ? "..."
              : (summary?.balance ?? 0).toLocaleString("ru-RU", {
                  minimumFractionDigits: 0,
                })}
          </p>
        </div>
      </div>

      {/* Type Toggle */}
      <div className="flex gap-2">
        <Button
          variant={reportType === "expense" ? "default" : "outline"}
          className={`flex-1 ${reportType === "expense" ? "bg-expense text-white" : ""}`}
          size="sm"
          onClick={() => setReportType("expense")}
        >
          {t("filter_expense")}
        </Button>
        <Button
          variant={reportType === "income" ? "default" : "outline"}
          className={`flex-1 ${reportType === "income" ? "bg-income text-white" : ""}`}
          size="sm"
          onClick={() => setReportType("income")}
        >
          {t("filter_income")}
        </Button>
      </div>

      {/* Pie Chart */}
      {catLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : pieData.length > 0 ? (
        <div className="tg-card">
          <p className="text-sm font-semibold mb-3">{t("by_category")}</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.18 0.015 265)",
                    border: "none",
                    borderRadius: "8px",
                    color: "#fff",
                    fontSize: "12px",
                  }}
                  formatter={(value: number) =>
                    value.toLocaleString("ru-RU", { minimumFractionDigits: 2 })
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Legend */}
          <div className="space-y-2 mt-2">
            {pieData.map((d, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: d.color }}
                  />
                  <span className="text-xs">
                    {d.icon} {d.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">
                    {d.value.toLocaleString("ru-RU", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {totalForType > 0
                      ? ((d.value / totalForType) * 100).toFixed(0)
                      : 0}
                    %
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="tg-card text-center py-8">
          <TrendingUp className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {t("no_data")}
          </p>
        </div>
      )}
    </div>
  );
}

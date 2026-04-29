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
  Briefcase,
  Send,
  X,
  Eye,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
type BudgetFilter = "all" | "personal" | "family" | "work";

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
  const [budgetFilter, setBudgetFilter] = useState<BudgetFilter>("all");
  const [businessGroupFilter, setBusinessGroupFilter] = useState<string>("all");
  const [showCsvMenu, setShowCsvMenu] = useState(false);
  const [csvPreview, setCsvPreview] = useState<{ csv: string; filename: string } | null>(null);

  // Fetch family groups to determine if user has a family
  const { data: familyGroups } = trpc.family.myGroups.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const hasFamily = (familyGroups?.length ?? 0) > 0;
  const familyGroupId = hasFamily ? familyGroups![0].group.id : undefined;

  // Fetch business groups
  const { data: businessGroups } = trpc.business.myGroups.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const hasBusiness = (businessGroups?.length ?? 0) > 0;

  const range = useMemo(() => getPeriodRange(period), [period]);

  // Build query params — include familyGroupId and scope only when viewing family reports
  const summaryParams = useMemo(() => {
    const base: Record<string, any> = { ...range };
    if (budgetFilter === "work") {
      base.isWork = true;
      if (businessGroupFilter !== "all") base.businessGroupId = parseInt(businessGroupFilter);
    } else if (budgetFilter === "family" && hasFamily && scope !== "mine") {
      return { ...base, familyGroupId, scope };
    } else if (budgetFilter === "all" && hasFamily && scope !== "mine") {
      return { ...base, familyGroupId, scope };
    }
    return base;
  }, [range, hasFamily, scope, familyGroupId, budgetFilter, businessGroupFilter]);

  const byCategoryParams = useMemo(() => {
    const base: Record<string, any> = { ...range, type: reportType };
    if (budgetFilter === "work") {
      base.isWork = true;
      if (businessGroupFilter !== "all") base.businessGroupId = parseInt(businessGroupFilter);
    } else if (budgetFilter === "family" && hasFamily && scope !== "mine") {
      return { ...base, familyGroupId, scope };
    } else if (budgetFilter === "all" && hasFamily && scope !== "mine") {
      return { ...base, familyGroupId, scope };
    }
    return base;
  }, [range, reportType, hasFamily, scope, familyGroupId, budgetFilter, businessGroupFilter]);

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
      toast.success(t("csv_downloaded"));
      setShowCsvMenu(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const sendCsvToTelegram = trpc.reports.sendCsvToTelegram.useMutation({
    onSuccess: (data) => {
      toast.success(t("csv_sent_telegram"));
      setShowCsvMenu(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const previewCsv = trpc.reports.exportCsv.useMutation({
    onSuccess: (data) => {
      setCsvPreview(data);
      setShowCsvMenu(false);
    },
    onError: (err) => toast.error(err.message),
  });

  // Parse CSV string into rows for the preview table
  const csvRows = useMemo(() => {
    if (!csvPreview) return [];
    const lines = csvPreview.csv.replace(/^\uFEFF/, "").split("\n").filter(Boolean);
    return lines.map((line) => {
      const row: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === "," && !inQuotes) {
          row.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
      row.push(current);
      return row;
    });
  }, [csvPreview]);

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

  const isCsvBusy = exportCsv.isPending || sendCsvToTelegram.isPending || previewCsv.isPending;

  return (
    <div className="px-4 pt-4 space-y-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t("reports_title")}</h1>
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCsvMenu(!showCsvMenu)}
            disabled={isCsvBusy}
          >
            {isCsvBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Download className="h-3.5 w-3.5 mr-1" />
                {t("export_csv")}
              </>
            )}
          </Button>
          {showCsvMenu && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowCsvMenu(false)}
              />
              {/* Dropdown menu */}
              <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[200px]">
                <button
                  className="w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 hover:bg-accent transition-colors"
                  onClick={() => exportCsv.mutate(range)}
                  disabled={isCsvBusy}
                >
                  <Download className="h-4 w-4" />
                  {t("csv_download")}
                </button>
                <button
                  className="w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 hover:bg-accent transition-colors"
                  onClick={() => sendCsvToTelegram.mutate(range)}
                  disabled={isCsvBusy}
                >
                  <Send className="h-4 w-4" />
                  {t("csv_send_telegram")}
                </button>
                <button
                  className="w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 hover:bg-accent transition-colors"
                  onClick={() => previewCsv.mutate(range)}
                  disabled={isCsvBusy}
                >
                  <Eye className="h-4 w-4" />
                  {t("csv_preview")}
                </button>
              </div>
            </>
          )}
        </div>
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

      {/* Budget filter — shown when user has family or business groups */}
      {(hasFamily || hasBusiness) && (
        <div className="tg-card space-y-2">
          <div className="flex gap-1.5 flex-wrap">
            <Button
              variant={budgetFilter === "all" ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => setBudgetFilter("all")}
            >
              {t("all")}
            </Button>
            <Button
              variant={budgetFilter === "personal" ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => setBudgetFilter("personal")}
            >
              {t("personal")}
            </Button>
            {hasFamily && (
              <Button
                variant={budgetFilter === "family" ? "default" : "outline"}
                size="sm"
                className="text-xs"
                onClick={() => setBudgetFilter("family")}
              >
                <Users className="h-3 w-3 mr-1" />
                {t("family")}
              </Button>
            )}
            {hasBusiness && (
              <Button
                variant={budgetFilter === "work" ? "default" : "outline"}
                size="sm"
                className={`text-xs ${budgetFilter === "work" ? "bg-blue-600 text-white hover:bg-blue-700" : ""}`}
                onClick={() => setBudgetFilter("work")}
              >
                <Briefcase className="h-3 w-3 mr-1" />
                {t("work")}
              </Button>
            )}
          </div>

          {/* Business group sub-filter */}
          {budgetFilter === "work" && hasBusiness && businessGroups && businessGroups.length > 1 && (
            <Select value={businessGroupFilter} onValueChange={setBusinessGroupFilter}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder={t("all")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("all")}</SelectItem>
                {businessGroups.map((bg) => (
                  <SelectItem key={bg.id} value={bg.id.toString()}>
                    {bg.icon} {bg.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Family scope selector */}
          {(budgetFilter === "family" || budgetFilter === "all") && hasFamily && (
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary shrink-0" />
              <div className="flex gap-1.5 flex-1">
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

      {/* CSV Preview Modal — forced WHITE background with BLACK text */}
      {csvPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div
            className="w-[95vw] max-h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden"
            style={{ backgroundColor: "#ffffff", color: "#000000" }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b"
              style={{ backgroundColor: "#f3f4f6", borderColor: "#e5e7eb" }}
            >
              <h3 className="text-sm font-semibold" style={{ color: "#111827" }}>
                {csvPreview.filename}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 text-xs font-medium rounded-md"
                  style={{ backgroundColor: "#2563eb", color: "#ffffff" }}
                  onClick={() => {
                    exportCsv.mutate(range);
                    setCsvPreview(null);
                  }}
                >
                  <Download className="h-3 w-3 inline mr-1" />
                  {t("csv_download")}
                </button>
                <button
                  className="px-3 py-1.5 text-xs font-medium rounded-md"
                  style={{ backgroundColor: "#0088cc", color: "#ffffff" }}
                  onClick={() => {
                    sendCsvToTelegram.mutate(range);
                    setCsvPreview(null);
                  }}
                >
                  <Send className="h-3 w-3 inline mr-1" />
                  Telegram
                </button>
                <button
                  onClick={() => setCsvPreview(null)}
                  className="p-1 rounded-full hover:bg-gray-200"
                >
                  <X className="h-4 w-4" style={{ color: "#374151" }} />
                </button>
              </div>
            </div>
            {/* Table */}
            <div className="overflow-auto flex-1 p-2">
              <table
                className="w-full text-xs border-collapse"
                style={{ color: "#000000" }}
              >
                {csvRows.length > 0 && (
                  <thead>
                    <tr>
                      {csvRows[0].map((cell, i) => (
                        <th
                          key={i}
                          className="px-2 py-1.5 text-left font-semibold whitespace-nowrap border"
                          style={{
                            backgroundColor: "#e5e7eb",
                            color: "#111827",
                            borderColor: "#d1d5db",
                          }}
                        >
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {csvRows.slice(1).map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-2 py-1 whitespace-nowrap border"
                          style={{
                            backgroundColor: ri % 2 === 0 ? "#ffffff" : "#f9fafb",
                            color: "#000000",
                            borderColor: "#e5e7eb",
                          }}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {csvRows.length <= 1 && (
                <p className="text-center py-8" style={{ color: "#6b7280" }}>
                  {t("no_data")}
                </p>
              )}
            </div>
            {/* Footer */}
            <div
              className="px-4 py-2 text-xs border-t text-center"
              style={{ backgroundColor: "#f3f4f6", color: "#6b7280", borderColor: "#e5e7eb" }}
            >
              {csvRows.length > 1 ? `${csvRows.length - 1} ${t("csv_rows")}` : ""}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

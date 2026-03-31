import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Users,
  Plus,
  UserPlus,
  Copy,
  LogOut,
  Loader2,
  Crown,
  Eye,
  EyeOff,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

export default function Family() {
  const { isAuthenticated, user } = useAuth();
  const { t } = useLanguage();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [leavingGroupId, setLeavingGroupId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [showPermissions, setShowPermissions] = useState(false);

  const { data: groups, isLoading } = trpc.family.myGroups.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const hasGroup = groups && groups.length > 0;

  const { data: members } = trpc.family.members.useQuery(
    { familyGroupId: selectedGroupId! },
    { enabled: !!selectedGroupId }
  );

  // Permissions: who can see MY expenses
  const { data: myPermissions } = trpc.family.myPermissions.useQuery(
    { familyGroupId: selectedGroupId! },
    { enabled: !!selectedGroupId && showPermissions }
  );

  const utils = trpc.useUtils();

  const createGroup = trpc.family.create.useMutation({
    onSuccess: () => {
      utils.family.myGroups.invalidate();
      setShowCreate(false);
      setGroupName("");
      toast.success(t("group_created"));
    },
    onError: (err) => toast.error(err.message),
  });

  const joinGroup = trpc.family.join.useMutation({
    onSuccess: () => {
      utils.family.myGroups.invalidate();
      setShowJoin(false);
      setInviteCode("");
      toast.success(t("group_joined"));
    },
    onError: (err) => toast.error(err.message),
  });

  const leaveGroup = trpc.family.leave.useMutation({
    onSuccess: () => {
      utils.family.myGroups.invalidate();
      setLeavingGroupId(null);
      setSelectedGroupId(null);
      toast.success(t("group_left"));
    },
    onError: (err) => toast.error(err.message),
  });

  const setPermission = trpc.family.setPermission.useMutation({
    onSuccess: () => {
      utils.family.myPermissions.invalidate();
      toast.success(t("permission_updated"));
    },
    onError: (err) => toast.error(err.message),
  });

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success(t("code_copied"));
  };

  // Helper: check if a specific member can see my expenses
  const canMemberSeeMyExpenses = (memberId: number): boolean => {
    if (!myPermissions) return true; // default: visible
    const perm = myPermissions.find((p) => p.granteeId === memberId);
    if (!perm) return true; // no explicit permission = default visible
    return perm.canViewExpenses;
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">{t("initializing")}</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t("family_mode")}</h1>
        <div className="flex gap-2">
          {!hasGroup && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowJoin(true)}
            >
              <UserPlus className="h-3.5 w-3.5 mr-1" />
              {t("join_group")}
            </Button>
          )}
          {!hasGroup && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t("create_group")}
            </Button>
          )}
        </div>
      </div>

      {/* Groups List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : groups && groups.length > 0 ? (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.group.id} className="tg-card space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{g.group.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {t("group_members")}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => setLeavingGroupId(g.group.id)}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>

              {/* Invite Code */}
              <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-2">
                <span className="text-xs text-muted-foreground">{t("invite_code")}:</span>
                <span className="text-sm font-mono font-bold flex-1">
                  {g.group.inviteCode}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => copyInviteCode(g.group.inviteCode)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Show Members */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  const newId = selectedGroupId === g.group.id ? null : g.group.id;
                  setSelectedGroupId(newId);
                  if (!newId) setShowPermissions(false);
                }}
              >
                {selectedGroupId === g.group.id
                  ? t("hide_members")
                  : t("show_members")}
              </Button>

              {selectedGroupId === g.group.id && members && (
                <div className="space-y-1.5">
                  {members.map((m) => (
                    <div
                      key={m.member.id}
                      className="flex items-center gap-2 px-2 py-1.5"
                    >
                      <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-xs">
                        {(m.user.telegramFirstName || m.user.name || "?")[0]}
                      </div>
                      <span className="text-sm flex-1">
                        {m.user.telegramFirstName || m.user.name || t("member")}
                      </span>
                      {m.member.userId === g.group.ownerId && (
                        <Crown className="h-3.5 w-3.5 text-yellow-500" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Permissions Button */}
              {selectedGroupId === g.group.id && members && members.length > 1 && (
                <Button
                  variant={showPermissions ? "default" : "outline"}
                  size="sm"
                  className="w-full"
                  onClick={() => setShowPermissions(!showPermissions)}
                >
                  <Shield className="h-3.5 w-3.5 mr-1" />
                  {showPermissions ? t("hide_permissions") : t("show_permissions")}
                </Button>
              )}

              {/* Permissions Panel */}
              {selectedGroupId === g.group.id && showPermissions && members && (
                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <p className="text-xs font-semibold text-primary">
                      {t("permissions_title")}
                    </p>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-3">
                    {t("permissions_description")}
                  </p>

                  {members
                    .filter((m) => m.member.userId !== user?.id)
                    .map((m) => {
                      const canView = canMemberSeeMyExpenses(m.member.userId);
                      return (
                        <div
                          key={m.member.id}
                          className="flex items-center justify-between bg-secondary/30 rounded-lg px-3 py-2.5"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-xs">
                              {(m.user.telegramFirstName || m.user.name || "?")[0]}
                            </div>
                            <div>
                              <p className="text-sm font-medium">
                                {m.user.telegramFirstName || m.user.name || t("member")}
                              </p>
                              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                {canView ? (
                                  <>
                                    <Eye className="h-3 w-3" />
                                    {t("can_see_expenses")}
                                  </>
                                ) : (
                                  <>
                                    <EyeOff className="h-3 w-3" />
                                    {t("cannot_see_expenses")}
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={canView}
                            onCheckedChange={(checked) => {
                              setPermission.mutate({
                                familyGroupId: g.group.id,
                                granteeId: m.member.userId,
                                canViewExpenses: checked,
                              });
                            }}
                            disabled={setPermission.isPending}
                          />
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="tg-card text-center py-12">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">{t("no_family_groups")}</p>
          <p className="text-xs text-muted-foreground">
            {t("create_or_join_hint")}
          </p>
        </div>
      )}

      {/* Create Group Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md mx-auto">
          <DialogHeader>
            <DialogTitle>{t("create_group")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder={t("group_name_placeholder")}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="h-12"
            />
            <Button
              className="w-full h-12"
              onClick={() => createGroup.mutate({ name: groupName })}
              disabled={!groupName.trim() || createGroup.isPending}
            >
              {createGroup.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("create_group")
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Join Group Dialog */}
      <Dialog open={showJoin} onOpenChange={setShowJoin}>
        <DialogContent className="max-w-md mx-auto">
          <DialogHeader>
            <DialogTitle>{t("join_group")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder={t("invite_code")}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              className="h-12 font-mono text-center text-lg tracking-wider"
              maxLength={16}
            />
            <Button
              className="w-full h-12"
              onClick={() => joinGroup.mutate({ inviteCode })}
              disabled={!inviteCode.trim() || joinGroup.isPending}
            >
              {joinGroup.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("join_group")
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Leave Confirmation */}
      <AlertDialog
        open={!!leavingGroupId}
        onOpenChange={() => setLeavingGroupId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("leave_group_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("leave_group_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (leavingGroupId)
                  leaveGroup.mutate({ familyGroupId: leavingGroupId });
              }}
            >
              {t("leave_group")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { toast } from "sonner";

export default function Family() {
  const { isAuthenticated, user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [leavingGroupId, setLeavingGroupId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  const { data: groups, isLoading } = trpc.family.myGroups.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // User can only be in one family group at a time
  const hasGroup = groups && groups.length > 0;

  const { data: members } = trpc.family.members.useQuery(
    { familyGroupId: selectedGroupId! },
    { enabled: !!selectedGroupId }
  );

  const utils = trpc.useUtils();

  const createGroup = trpc.family.create.useMutation({
    onSuccess: () => {
      utils.family.myGroups.invalidate();
      setShowCreate(false);
      setGroupName("");
      toast.success("Группа создана!");
    },
    onError: (err) => toast.error(err.message),
  });

  const joinGroup = trpc.family.join.useMutation({
    onSuccess: () => {
      utils.family.myGroups.invalidate();
      setShowJoin(false);
      setInviteCode("");
      toast.success("Вы присоединились к группе!");
    },
    onError: (err) => toast.error(err.message),
  });

  const leaveGroup = trpc.family.leave.useMutation({
    onSuccess: () => {
      utils.family.myGroups.invalidate();
      setLeavingGroupId(null);
      setSelectedGroupId(null);
      toast.success("Вы покинули группу");
    },
    onError: (err) => toast.error(err.message),
  });

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("Код скопирован!");
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Войдите для просмотра</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Семейный режим</h1>
        <div className="flex gap-2">
          {!hasGroup && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowJoin(true)}
            >
              <UserPlus className="h-3.5 w-3.5 mr-1" />
              Войти
            </Button>
          )}
          {!hasGroup && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Создать
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
                      Участники группы
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
                <span className="text-xs text-muted-foreground">Код:</span>
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
                onClick={() =>
                  setSelectedGroupId(
                    selectedGroupId === g.group.id ? null : g.group.id
                  )
                }
              >
                {selectedGroupId === g.group.id
                  ? "Скрыть участников"
                  : "Показать участников"}
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
                      <span className="text-sm">
                        {m.user.telegramFirstName || m.user.name || "Участник"}
                      </span>
                      {m.member.userId === g.group.ownerId && (
                        <Crown className="h-3.5 w-3.5 text-yellow-500" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="tg-card text-center py-12">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">Нет семейных групп</p>
          <p className="text-xs text-muted-foreground">
            Создайте группу или присоединитесь по коду приглашения
          </p>
        </div>
      )}

      {/* Create Group Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md mx-auto">
          <DialogHeader>
            <DialogTitle>Создать группу</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Название группы"
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
                "Создать"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Join Group Dialog */}
      <Dialog open={showJoin} onOpenChange={setShowJoin}>
        <DialogContent className="max-w-md mx-auto">
          <DialogHeader>
            <DialogTitle>Присоединиться к группе</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Код приглашения"
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
                "Присоединиться"
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
            <AlertDialogTitle>Покинуть группу?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы больше не сможете видеть семейные транзакции этой группы.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (leavingGroupId)
                  leaveGroup.mutate({ familyGroupId: leavingGroupId });
              }}
            >
              Покинуть
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

'use client';
import { useState, useEffect, useRef } from 'react';
import { UserCog, Mail, Cpu, Upload, ShieldCheck, Save, Check, User as UserIcon } from 'lucide-react';
import { useMe, useConfig } from '../../lib/queries';
import { useUpdateMe, useUploadAvatar } from '../../lib/mutations';
import { allModels } from '../../lib/execPresets';
import { Avatar } from '../../components/ui/Avatar';
import { ModelIcon } from '../../components/ui/ModelIcon';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { SettingCard } from '../../components/ui/SettingCard';
import { ModuleHeader } from '../../components/ui/ModuleHeader';
import { LoadingState } from '../../components/ui/states';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from '../../lib/i18n';

export function AccountView() {
  const me = useMe();
  const { data: config } = useConfig();
  const updateMe = useUpdateMe();
  const uploadAvatar = useUploadAvatar();
  const { toast } = useToast();
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [defaultExec, setDefaultExec] = useState('');

  useEffect(() => {
    if (me.data?.user) {
      setName(me.data.user.name);
      setEmail(me.data.user.email);
      setDefaultExec(me.data.user.default_exec);
    }
  }, [me.data]);

  if (me.isLoading || !me.data) {
    return <><ModuleHeader title={t.account.title} icon={UserCog} /><LoadingState /></>;
  }

  const u = me.data.user;
  const custom = config?.customModels ?? [];
  // Models the user may pick a default from: their admin allow-list, or all globally-allowed when
  // they have no per-user restriction.
  const restricted = u.allowed_execs.length > 0;
  const pickable = restricted ? u.allowed_execs : (config?.allowedExecs ?? []);
  const labelOf = (exec: string) => allModels(custom).find((m) => m.exec === exec)?.label ?? exec;

  const save = () => updateMe.mutate(
    { name: name.trim(), email: email.trim(), default_exec: defaultExec },
    { onSuccess: () => toast(t.account.saved), onError: (e) => toast(String(e) || t.account.saveError, 'error') },
  );
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) uploadAvatar.mutate(f, { onSuccess: () => toast(t.account.avatarSaved), onError: (er) => toast(String(er) || t.account.saveError, 'error') });
    e.target.value = ''; // allow re-selecting the same file
  };

  return (
    <>
      <ModuleHeader title={t.account.title} icon={UserCog}>
        <Button variant="accent" icon={Save} onClick={save} disabled={updateMe.isPending}>{t.account.save}</Button>
      </ModuleHeader>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Left rail: the models you may run, big icons — tap one to make it your default. */}
        <div className="flex shrink-0 flex-col gap-2 lg:w-72">
          <span className="flex items-center gap-2 text-sm font-medium text-text">
            <Cpu size={16} className="text-text-muted" aria-hidden />{t.account.defaultModel}
          </span>
          <p className="text-xs text-text-muted">{restricted ? t.account.restrictedHint : t.account.defaultModelHint}</p>
          {pickable.length === 0 ? (
            <p className="mt-1 text-xs italic text-text-muted">{t.account.noModelLimit}</p>
          ) : (
            <div role="radiogroup" className="mt-1 flex flex-col gap-2">
              {pickable.map((exec) => {
                const on = defaultExec === exec;
                return (
                  <button
                    key={exec}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={labelOf(exec)}
                    onClick={() => setDefaultExec(on ? '' : exec)}
                    className={`group flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${on ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:bg-elevated'}`}
                    style={{ transitionDuration: 'var(--motion-fast)' }}
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-elevated">
                      <ModelIcon name={exec} size={28} />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-text">{labelOf(exec)}</span>
                      <span className="truncate font-mono text-tiny text-text-muted">{exec}</span>
                    </span>
                    {on ? <Check size={16} className="ml-auto shrink-0 text-accent" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Main: identity + profile, full width. */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-5">
            <Avatar user={u} size={72} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-lg font-semibold text-text">{u.name || u.username}</span>
                {u.is_admin ? <Badge tone="accent"><ShieldCheck size={11} className="mr-1" aria-hidden />{t.users.admin}</Badge> : null}
              </span>
              <span className="truncate font-mono text-xs text-text-muted">@{u.username}</span>
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onFile} />
            <Button variant="ghost" icon={Upload} onClick={() => fileRef.current?.click()} disabled={uploadAvatar.isPending}>{t.account.uploadAvatar}</Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SettingCard title={t.account.name} icon={UserIcon}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </SettingCard>
            <SettingCard title={t.account.email} icon={Mail}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </SettingCard>
          </div>
        </div>
      </div>
    </>
  );
}

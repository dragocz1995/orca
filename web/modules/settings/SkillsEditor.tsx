'use client';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from '../../lib/i18n';
import { usePluginSkills } from '../../lib/queries';
import { useCreatePluginSkill, useUpdatePluginSkill, useDeletePluginSkill } from '../../lib/mutations';
import { apiErrorMessage } from '../../lib/elowenClient';
import type { PluginSkill } from '../../lib/types';
import { MarkdownAssetEditor, type AssetForm } from './MarkdownAssetEditor';

type SkillExtra = { disableModelInvocation: boolean };
type SkillForm = AssetForm<SkillExtra>;
const EMPTY_FORM: SkillForm = { editing: null, name: '', description: '', body: '', disableModelInvocation: false };

/** Skills manager (the skills plugin detail): bundled skills ship read-only with the install; user
 *  skills are one .md file each and can be created, edited and deleted here. Changes hot-reload the
 *  plugins, so NEW brain conversations pick them up immediately. The `disable-model-invocation` toggle
 *  hides a skill from progressive disclosure while keeping it reachable via /skill:name. */
export function SkillsEditor() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const query = usePluginSkills();
  const create = useCreatePluginSkill();
  const update = useUpdatePluginSkill();
  const remove = useDeletePluginSkill();

  // Quick per-row switch: flip the flag without opening the full editor.
  const toggleInvocation = (skill: PluginSkill, next: boolean) => {
    update.mutate(
      { name: skill.name, patch: { disableModelInvocation: next } },
      { onError: (e) => toast(apiErrorMessage(e), 'error') },
    );
  };

  return (
    <MarkdownAssetEditor<PluginSkill, SkillExtra>
      query={query}
      labels={{
        empty: t.skills.empty,
        badgeUser: t.skills.badgeUser,
        badgeBuiltin: t.skills.badgeBundled,
        add: t.skills.add,
        edit: t.skills.edit,
        remove: t.skills.remove,
        save: t.skills.save,
        cancel: t.skills.cancel,
        name: t.skills.name,
        nameHint: t.help.skillName,
        namePlaceholder: 'deploy-checklist',
        description: t.skills.description,
        descriptionHint: t.help.skillDescription,
        body: t.skills.content,
        bodyHint: t.help.skillContent,
        created: t.skills.created,
        updated: t.skills.updated,
        deleted: t.skills.deleted,
        deleteTitle: t.skills.deleteTitle,
        deleteDesc: t.skills.deleteDesc,
      }}
      emptyForm={EMPTY_FORM}
      formFromItem={(skill) => ({
        editing: skill.name,
        name: skill.name,
        description: skill.description,
        body: skill.content ?? '',
        disableModelInvocation: skill.disableModelInvocation,
      })}
      renderBadges={(skill) => (skill.disableModelInvocation ? <Badge tone="default">{t.skills.manualOnlyBadge}</Badge> : null)}
      renderRowControl={(skill) => (
        <Toggle
          checked={skill.disableModelInvocation}
          onChange={(next) => toggleInvocation(skill, next)}
          label={t.skills.disableModelInvocation}
          disabled={update.isPending}
        />
      )}
      renderFieldsAfterBody={(form, patch) => (
        <label className="flex items-center gap-2">
          <Toggle
            checked={form.disableModelInvocation}
            onChange={(next) => patch({ disableModelInvocation: next })}
            label={t.skills.disableModelInvocation}
          />
          <span className="flex flex-col">
            <span className="text-sm text-text">{t.skills.disableModelInvocation}</span>
            <span className="text-xs text-text-muted">{t.skills.disableModelInvocationHint}</span>
          </span>
        </label>
      )}
      onSave={(form, callbacks) => {
        if (form.editing !== null) {
          update.mutate(
            { name: form.editing, patch: { description: form.description.trim(), content: form.body, disableModelInvocation: form.disableModelInvocation } },
            callbacks,
          );
        } else {
          create.mutate(
            { name: form.name.trim(), description: form.description.trim(), content: form.body, disableModelInvocation: form.disableModelInvocation },
            callbacks,
          );
        }
      }}
      saving={create.isPending || update.isPending}
      onDelete={(name, callbacks) => remove.mutate(name, callbacks)}
    />
  );
}

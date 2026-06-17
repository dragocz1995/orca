import { Panel } from '../../components/ui/Panel';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/states';

export default function SettingsPage() {
  return (
    <Panel>
      <PageHeader title="Settings" />
      <EmptyState title="Coming soon" description="Model allowlist + autopilot config land in the next slice." />
    </Panel>
  );
}

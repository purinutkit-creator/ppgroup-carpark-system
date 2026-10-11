/**
 * Admin → Appearance: Global Font & Design Management.
 */
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '../../../components/ui';
import '../../../components/appearance/appearance.css';
import { AppearanceProvider, useAppearance } from './context';
import { GlobalTypography } from './GlobalTypography';
import { VisualEditor } from './VisualEditor';
import { DesignTokens } from './DesignTokens';
import { FontsLibrary } from './FontsLibrary';
import { PrintFonts } from './PrintFonts';
import { MediaImages } from './MediaImages';
import { Versions } from './Versions';
import { dateTime } from '../../../lib/format';

const TABS = [
  { id: 'typography', label: 'Global Typography' },
  { id: 'editor', label: 'Visual Font Editor' },
  { id: 'tokens', label: 'Design Tokens' },
  { id: 'fonts', label: 'Fonts Library' },
  { id: 'print', label: 'Print Fonts' },
  { id: 'media', label: 'Media & Images' },
  { id: 'versions', label: 'Versions' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function Header() {
  const { data } = useAppearance();
  const v = data.version;
  return (
    <span className="small muted">
      Design Configuration v{v.versionNo}
      {v.createdAt ? ` · ${v.createdBy ?? '-'} · ${dateTime(v.createdAt)}` : ' · ค่าเริ่มต้น'}
    </span>
  );
}

export default function Appearance() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'typography') as TabId;
  return (
    <AppearanceProvider fallback={({ loading, error }) => <div className={error ? 'empty' : 'page-loading'}>{error ?? (loading ? 'กำลังโหลด…' : '')}</div>}>
      <div className="page-header">
        <h1>Appearance & Fonts</h1>
        <div className="actions">
          <Header />
        </div>
      </div>
      <Tabs tabs={[...TABS]} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      {tab === 'typography' && <GlobalTypography />}
      {tab === 'editor' && <VisualEditor />}
      {tab === 'tokens' && <DesignTokens />}
      {tab === 'fonts' && <FontsLibrary />}
      {tab === 'print' && <PrintFonts />}
      {tab === 'media' && <MediaImages />}
      {tab === 'versions' && <Versions />}
    </AppearanceProvider>
  );
}

import { useNavigate } from 'react-router-dom';
import { writeXlsx } from '../xlsx';
import { useT } from '../i18n';
import { BLANK_ROWS, EXAMPLE_ROWS, WIDTHS } from '../importSamples';

function save(name: string, bytes: Uint8Array) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}


const Tag = ({ children }: { children: React.ReactNode }) => <span className="gd-tag">{children}</span>;

/** How to import: five short steps. */
export default function Guide() {
  const { t } = useT(); const nav = useNavigate();
  const step = (n: number, title: string, body: React.ReactNode, btns?: React.ReactNode) => (
    <li><span className="gd-n" aria-hidden="true">{n}</span><div><b>{title}</b><p>{body}</p>{btns && <div className="gd-btns">{btns}</div>}</div></li>
  );
  return (
    <div className="guide">
      <section className="card gd-card">
        <h2>{t('How to import')}</h2>
        <div className="sub">{t('Write in one language only. The AI fills the others.')}</div>
        <ol className="gd-list">
          {step(1, t('Set the languages (once)'), t('Choose the country and tick the languages, then press Save languages.'),
            <button className="btn sm" type="button" onClick={() => nav('/admin/kb', { state: { tab: 'languages' } })}>{t('Open Languages')}</button>)}
          {step(2, t('Add your entries'), t('On the Import page, type in the table (or paste from Excel), or upload an Excel file.'),
            <><button className="btn pri sm" type="button" onClick={() => save('knowledge_base_example.xlsx', writeXlsx(EXAMPLE_ROWS, WIDTHS, 'Knowledge base'))}>{t('Download example file')}</button>
              <button className="btn sm" type="button" onClick={() => save('knowledge_base_blank.xlsx', writeXlsx(BLANK_ROWS, WIDTHS, 'Knowledge base'))}>{t('Download blank file')}</button></>)}
          {step(3, t('Fill each row'), t('Entry name, topic, at least 3 questions with a | between them, and the answer. Write in the main language only.'))}
          {step(4, t('Import'), t('Press Import and publish to go live at once, or Import to draft to check first.'))}
          {step(5, t('Check the AI drafts'), t('In Knowledge base → Table, read the purple “AI draft” texts and fix what you want.'))}
        </ol>
        <div className="gd-end">✓ {t('Done. The bot now answers from your new entries.')}</div>
      </section>
    </div>
  );
}

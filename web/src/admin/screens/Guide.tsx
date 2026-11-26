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

/** How to import: the steps only, with the buttons drawn the way they look on the screen. */
export default function Guide() {
  const { t } = useT(); const nav = useNavigate();
  const step = (n: number, title: string, body: React.ReactNode) => (
    <li><span className="gd-n" aria-hidden="true">{n}</span><div><b>{title}</b>{body}</div></li>
  );
  return (
    <div className="guide">
      <section className="card gd-card">
        <h2>{t('How to import')}</h2>
        <div className="sub">{t('Add many answers at one time. Write in one language only: the AI fills the other languages.')}</div>
        <ol className="gd-list">
          {step(1, t('Set the languages first (once)'), <>
            <p>{t('Open Knowledge base → Languages. Choose the country (it sets the main language), tick the languages the merchant uses, and press Save languages.')}</p>
            <div className="gd-btns"><button className="btn sm" type="button" onClick={() => nav('/admin/kb', { state: { tab: 'languages' } })}>{t('Open Languages')}</button></div></>)}
          {step(2, t('Add your entries'), <>
            <p>{t('On the Import page there are two ways. Choose one:')}</p>
            <ul className="gd-sub">
              <li><Tag>{t('Type in a table')}</Tag> {t('Type in the cells, or copy cells from Excel or Google Sheets and paste them (click the first cell, then press Ctrl+V). Use Add 5 rows for more rows and Clear table to start again.')}</li>
              <li><Tag>{t('Upload a file')}</Tag> {t('Fill the Excel file and upload it.')}
                <div className="gd-btns"><button className="btn pri sm" type="button" onClick={() => save('knowledge_base_example.xlsx', writeXlsx(EXAMPLE_ROWS, WIDTHS, 'Knowledge base'))}>{t('Download example file')}</button>
                  <button className="btn sm" type="button" onClick={() => save('knowledge_base_blank.xlsx', writeXlsx(BLANK_ROWS, WIDTHS, 'Knowledge base'))}>{t('Download blank file')}</button></div></li>
            </ul></>)}
          {step(3, t('Fill each row'), <>
            <p>{t('Entry name: one short name with no spaces, for example deposit_time. Topic: the topic word, for example deposit (it must exist on the Topics page). Questions: at least 3 example questions, with a | between them, with the short forms customers really type. Answer: the answer text.')}</p>
            <p>{t('Write in the main language only. The Language column starts with it. The AI writes the other languages for you. If you write another language yourself, put it in its own row with the same entry name.')}</p></>)}
          {step(4, t('Check'), <p>{t('The Check step lists every entry and shows what is wrong, for example a missing topic or fewer than 3 questions. Fix it in the table, or leave it: the entry is still imported and you can fix it later.')}</p>)}
          {step(5, t('Import'), <>
            <p>{t('The switch “Translate the empty languages with AI” follows the merchant setting. It translates into the languages you ticked in step 1. Then choose:')}</p>
            <div className="gd-btns"><span className="gd-tag solid">{t('Import and publish')}</span><span className="gd-tag">{t('Import entries to draft')}</span></div>
            <p className="sub">{t('Import and publish makes the entries live at once. Import to draft only saves them: nothing changes for customers until you publish.')}</p></>)}
          {step(6, t('Check the AI drafts'), <p>{t('In Knowledge base → Table, the texts written by the AI are purple and marked “AI draft · check”. Read them, fix what you want (the mark goes away), and use the Live switch to turn an entry on or off.')}</p>)}
        </ol>
        <div className="gd-end">✓ {t('Done. The bot now answers from your new entries.')}</div>
      </section>
    </div>
  );
}

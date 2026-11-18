import { writeXlsx } from '../xlsx';
import { BLANK_ROWS, EXAMPLE_ROWS, WIDTHS } from '../importSamples';

function save(name: string, bytes: Uint8Array) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}


const Tag = ({ children }: { children: React.ReactNode }) => <span className="gd-tag">{children}</span>;

/** How to import: the steps only, with the buttons drawn the way they look on the screen. */
export default function Guide() {
  return (
    <div className="guide">
      <section className="card gd-card">
        <h2>How to import</h2>
        <div className="sub">Add many answers at one time. It takes about 5 minutes.</div>
        <ol className="gd-list">
          <li><span className="gd-n" aria-hidden="true">1</span><div><b>Get the Excel file</b><p>Download it and open it in Excel.</p>
            <div className="gd-btns"><button className="btn pri sm" type="button" onClick={() => save('knowledge_base_example.xlsx', writeXlsx(EXAMPLE_ROWS, WIDTHS, 'Knowledge base'))}>Download example file</button>
              <button className="btn sm" type="button" onClick={() => save('knowledge_base_blank.xlsx', writeXlsx(BLANK_ROWS, WIDTHS, 'Knowledge base'))}>Download blank file</button></div></div></li>
          <li><span className="gd-n" aria-hidden="true">2</span><div><b>Fill it in</b><p>One row for each question and its answer. English is enough.</p></div></li>
          <li><span className="gd-n" aria-hidden="true">3</span><div><b>Upload it</b><p>Go to <b>Import</b>, press <Tag>Upload a file</Tag> and choose your Excel file.</p></div></li>
          <li><span className="gd-n" aria-hidden="true">4</span><div><b>Import it</b><p>Check the list, then press <Tag>Import</Tag>. If you see <i>Translate the empty languages with AI</i>, keep it ticked.</p></div></li>
          <li><span className="gd-n" aria-hidden="true">5</span><div><b>Publish it</b><p>Press the button in the yellow bar at the top. Customers see the answers only after this.</p>
            <div className="gd-bar" aria-hidden="true"><span><b>Not live yet.</b> 5 changes are only in your draft.</span><span className="gd-tag solid">Review and publish</span></div></div></li>
        </ol>
        <div className="gd-end">✓ Done. The bot now answers from your new entries.</div>
      </section>
    </div>
  );
}

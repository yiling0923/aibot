import { writeXlsx } from '../xlsx';
import { BLANK_ROWS, EXAMPLE_ROWS, WIDTHS } from '../importSamples';

function save(name: string, bytes: Uint8Array) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}


/** How to import: the steps only. */
export default function Guide() {
  return (
    <div className="guide">
      <section className="card">
        <h2>How to import</h2>
        <ol className="gd-plain">
          <li><b>Get the Excel file.</b> <button className="btn sm" type="button" onClick={() => save('knowledge_base_example.xlsx', writeXlsx(EXAMPLE_ROWS, WIDTHS, 'Knowledge base'))}>Download example file</button> <button className="btn sm" type="button" onClick={() => save('knowledge_base_blank.xlsx', writeXlsx(BLANK_ROWS, WIDTHS, 'Knowledge base'))}>Download blank file</button></li>
          <li><b>Fill it in.</b> One row for each question and its answer. English is enough.</li>
          <li><b>Go to Import</b> and press <b>Upload a file</b>. Choose your Excel file.</li>
          <li><b>Check the list</b> that appears, then press the <b>Import</b> button. Tick <b>Translate the empty languages with AI</b> if you see it.</li>
          <li><b>Press Publish</b> (the yellow bar at the top). Now customers can see the answers.</li>
        </ol>
      </section>
    </div>
  );
}

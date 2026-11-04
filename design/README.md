# Design files

* `mockups/chat_mockup.html` and `mockups/control_panel_mockup.html`: clickable mockups (open them in a browser). They are the reference for the chat page (phase 4) and the control panel (phase 5).
* `template-data/`: the fake data the mockups use, plus the earlier SQL, CSV import examples and the prompt for generating more data.
  The real project loads `../data/kb_seed.json` through `npm run db:seed`.
* `template-data/ui_chinese_labels_for_later.py`: the Chinese translations of the control panel labels, kept for when a Chinese interface is wanted.
